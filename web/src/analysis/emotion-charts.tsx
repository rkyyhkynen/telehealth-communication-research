import { useEffect, useMemo, useRef, useState } from 'react';
import { DataProcessor } from './dataProcessor';
import { ChartJS, type Chart } from './chart-runtime';
import {
  getExpressionInterpretations,
  getExpressionTimelineInterpretations
} from './interpretations';
import { translateUiText, type AppLocale } from '../shared/locale';

type EmotionTimelineSegment = {
  emotion: string;
  startTime: number;
  endTime: number;
  averageScore: number;
  duration: number;
};

const EMOTION_COLORS: Record<string, string> = {
  happy: 'rgba(75, 192, 192, 0.6)',
  sad: 'rgba(255, 99, 132, 0.6)',
  angry: 'rgba(255, 206, 86, 0.6)',
  surprise: 'rgba(54, 162, 235, 0.6)',
  neutral: 'rgba(153, 102, 255, 0.6)',
  fear: 'rgba(255, 159, 64, 0.6)',
  disgust: 'rgba(255, 20, 147, 0.6)'
};

const EMOTION_EMOJIS: Record<string, string> = {
  happy: '🙂',
  sad: '😔',
  angry: '😠',
  surprise: '😮',
  neutral: '😐',
  fear: '😨',
  disgust: '🤢'
};

type EmotionChartsSectionProps = {
  locale: AppLocale;
  dataRevision: number;
};

const EMOTION_LABELS: Record<string, string> = {
  happy: 'Iloinen',
  sad: 'Surullinen',
  angry: 'Vihainen',
  surprise: 'Yllättynyt',
  neutral: 'Neutraali',
  fear: 'Pelokas',
  disgust: 'Inho'
};

function capitalize(text: string): string {
  if (!text) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.max(0, Math.floor(seconds) % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function toRgbaAlpha(color: string, alpha: number): string {
  const rgbaMatch = color.match(/^rgba?\(([^)]+)\)$/i);
  if (!rgbaMatch) {
    return color;
  }

  const parts = rgbaMatch[1].split(',').map(part => part.trim());
  if (parts.length < 3) {
    return color;
  }

  const clampedAlpha = Math.max(0, Math.min(1, alpha));
  return `rgba(${parts[0]}, ${parts[1]}, ${parts[2]}, ${clampedAlpha})`;
}

function getEmotionEmoji(emotion: string): string {
  return EMOTION_EMOJIS[emotion.toLowerCase()] || '🙂';
}

function translateEmotionName(emotion: string, locale: AppLocale): string {
  if (locale === 'fi') {
    return EMOTION_LABELS[emotion.toLowerCase()] || capitalize(emotion);
  }
  return capitalize(emotion);
}

function getStrengthLabel(score: number, locale: AppLocale): string {
  if (score >= 0.85) {
    return locale === 'fi' ? 'Korkea' : 'High';
  }
  if (score >= 0.72) {
    return locale === 'fi' ? 'Keskitaso' : 'Medium';
  }
  return locale === 'fi' ? 'Matala' : 'Low';
}

function EmotionDoughnutChart(props: EmotionChartsSectionProps) {
  const { locale, dataRevision } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart<'doughnut', number[], string> | null>(null);
  const [hasEmotionData, setHasEmotionData] = useState(true);
  const tr = (text: string) => translateUiText(text, locale);

  useEffect(() => {
    if (dataRevision <= 0) {
      return;
    }

    const labels = Object.keys(DataProcessor.emotionCounts || {});
    const counts = Object.values(DataProcessor.emotionCounts || {});
    const hasData = labels.length > 0 && counts.some(count => Number(count) > 0);
    setHasEmotionData(hasData);

    if (!hasData) {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const colors = labels.map(label => EMOTION_COLORS[label] || 'rgba(128, 128, 128, 0.6)');
    const borderColors = colors.map(color => toRgbaAlpha(color, 1));
    const totalCount = counts.reduce((sum, count) => sum + count, 0);

    chartRef.current = new ChartJS(canvas, {
      type: 'doughnut',
      data: {
        labels: labels.map(label => translateEmotionName(label, locale)),
        datasets: [{
          label: tr('Emotion Distribution'),
          data: counts,
          backgroundColor: colors,
          borderColor: borderColors,
          borderWidth: 1
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: true,
        layout: {
          padding: {
            top: 20,
            bottom: 20,
            left: 20,
            right: 20
          }
        },
        plugins: {
          legend: {
            position: 'top'
          },
          tooltip: {
            callbacks: {
              label: context => {
                const label = context.label || '';
                const value = Number(context.raw) || 0;
                return `${label}: ${tr('Count')} ${value}`;
              }
            }
          },
          datalabels: {
            display: true,
            font: {
              size: 15
            },
            formatter: (value: number) => {
              if (totalCount <= 0) {
                return '0%';
              }
              const percentage = Math.round((value / totalCount) * 100);
              return `${percentage}%`;
            }
          }
        }
      }
    });

    return () => {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
    };
  }, [dataRevision, locale]);

  if (!hasEmotionData) {
    return <div className="visual-empty-state">{tr('No emotion data detected')}</div>;
  }

  return <canvas ref={canvasRef} className="emotion-doughnut-canvas" />;
}

function EmotionTimelineStrip(props: EmotionChartsSectionProps) {
  const { locale, dataRevision } = props;
  const tr = (text: string) => translateUiText(text, locale);

  const timelineData = useMemo(() => {
    if (dataRevision <= 0) {
      return { hasData: false, segments: [] as EmotionTimelineSegment[], totalDuration: 0 };
    }

    const hasEmotionData = Object.keys(DataProcessor.emotionCounts || {}).length > 0;
    const segments = DataProcessor.getEmotionTimelineSegments() as EmotionTimelineSegment[];
    const totalDuration = DataProcessor.getCallDuration() || 0;
    const hasData = hasEmotionData && totalDuration > 0 && segments.length > 0;

    return { hasData, segments, totalDuration };
  }, [dataRevision]);

  if (!timelineData.hasData) {
    return <div className="visual-empty-state">{tr('No emotion data detected')}</div>;
  }

  const sessionEmotions = Array.from(new Set(timelineData.segments.map(segment => segment.emotion)));
  const axisTicks: number[] = [];
  for (let t = 30; t <= timelineData.totalDuration; t += 30) {
    axisTicks.push(t);
  }

  return (
    <div className="emotion-timeline-outer">
      <div className="emotion-legend">
        {sessionEmotions.map(emotion => (
          <div className="legend-item" key={emotion}>
            <span className="legend-color" style={{ backgroundColor: EMOTION_COLORS[emotion] || 'rgba(128, 128, 128, 0.6)' }} />
            <span className="legend-label">{getEmotionEmoji(emotion)} {translateEmotionName(emotion, locale)}</span>
          </div>
        ))}
        <div className="legend-item">
          <span className="legend-color" style={{ backgroundColor: '#e2e8f0', border: '1px solid #cbd5e1' }} />
          <span className="legend-label">{tr('No strong expression detected')}</span>
        </div>
      </div>

      <div className="emotion-timeline-container">
        {timelineData.segments.map((segment, index) => {
          const width = (segment.duration / timelineData.totalDuration) * 100;
          const left = (segment.startTime / timelineData.totalDuration) * 100;
          const baseColor = EMOTION_COLORS[segment.emotion] || 'rgba(128, 128, 128, 0.6)';
          const rawOpacity = 0.4 + (segment.averageScore - 0.6) * 1.5;
          const colorWithOpacity = toRgbaAlpha(baseColor, Number(rawOpacity.toFixed(2)));
          const isNeutral = segment.emotion.toLowerCase() === 'neutral';
          const showEmoji = width >= 10;

          return (
            <div
              className="emotion-segment"
              key={`${segment.emotion}-${segment.startTime}-${index}`}
              style={{
                position: 'absolute',
                left: `${left}%`,
                width: width <= 0 ? '2px' : `${width}%`,
                backgroundColor: colorWithOpacity
              }}
            >
              {showEmoji ? (
                <span className="emotion-segment-emoji">{getEmotionEmoji(segment.emotion)}</span>
              ) : null}
              <div className="emotion-tooltip">
                <strong>{translateEmotionName(segment.emotion, locale)}</strong>
                <br />
                {isNeutral ? null : (
                  <>
                    {tr('Expression strength')}: {getStrengthLabel(segment.averageScore, locale)}
                    <br />
                  </>
                )}
                {tr('Time')}: {Math.round(segment.startTime)}-{Math.round(segment.endTime)}s
              </div>
            </div>
          );
        })}

        <div className="timeline-axis">
          {axisTicks.map(tick => {
            const left = (tick / timelineData.totalDuration) * 100;
            return (
              <div className="axis-tick" key={tick} style={{ left: `${left}%` }}>
                <span className="axis-label">{formatSeconds(tick)}</span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

export function EmotionChartsSection(props: EmotionChartsSectionProps) {
  const { locale, dataRevision } = props;
  const tr = (text: string) => translateUiText(text, locale);
  const expressionInterpretations = getExpressionInterpretations();
  const expressionTimelineInterpretations = getExpressionTimelineInterpretations();

  return (
    <div className="chart-box" data-revision={dataRevision}>
      <div className="side-by-side-container">
        <div className="half-width-chart">
          <h2 className="chart-title">{tr('Facial expressions')}</h2>
          <div className="chart-container">
            <EmotionDoughnutChart locale={locale} dataRevision={dataRevision} />
          </div>
          <details className="learn-more-disclosure">
            <summary className="learn-more-summary">{tr('Learn more ▾')}</summary>
            <div className="learn-more-content">
              <h3>{tr('Your most frequent expressions')}</h3>
              <ul>
                {expressionInterpretations.length === 0 ? (
                  <li>{tr('No emotion interpretation available')}</li>
                ) : (
                  expressionInterpretations.map(item => (
                    <li key={item.label}>
                      <strong>{tr(item.label)}:</strong> {tr(item.text)}
                    </li>
                  ))
                )}
              </ul>
            </div>
          </details>
        </div>

        <div className="half-width-chart">
          <h2 className="chart-title">{tr('Facial expressions timeline')}</h2>
          <div className="chart-container">
            <EmotionTimelineStrip locale={locale} dataRevision={dataRevision} />
          </div>
          <details className="learn-more-disclosure">
            <summary className="learn-more-summary">{tr('Learn more ▾')}</summary>
            <div className="learn-more-content">
              <h3>{tr('How to read this')}</h3>
              <ul>
                {expressionTimelineInterpretations.map(item => (
                  <li key={item}>{tr(item)}</li>
                ))}
              </ul>
            </div>
          </details>
        </div>
      </div>
    </div>
  );
}
