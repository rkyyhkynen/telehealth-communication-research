import { useMemo, useState } from 'react';
import { DataProcessor } from './dataProcessor';
import { translateUiText, type AppLocale } from '../shared/locale';

type SummaryMetrics = {
  meetingDuration: string;
  meetingDate: string;
  eyeContactValue: string;
  eyeContactDetail: string;
  bodyLanguageValue: string;
  bodyLanguageDetail: string;
  postureValue: string;
  postureDetail: string;
  speakingTimeValue: string;
  speakingTimeDetail: string;
  dominantEmotionValue: string;
  expressionCountDetail: string;
};

type AnalysisSummaryHeaderProps = {
  locale: AppLocale;
  onOpenInsights: () => void;
  dataRevision: number;
};

function formatMeetingDate(locale: AppLocale): string {
  return new Date().toLocaleDateString(locale === 'fi' ? 'fi-FI' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric'
  });
}

function fallbackMetrics(locale: AppLocale): SummaryMetrics {
  return {
    meetingDuration: 'No call duration yet',
    meetingDate: formatMeetingDate(locale),
    eyeContactValue: 'No data',
    eyeContactDetail: 'No gaze data',
    bodyLanguageValue: 'No data',
    bodyLanguageDetail: 'No nodding data',
    postureValue: 'No data',
    postureDetail: 'No shoulder data',
    speakingTimeValue: 'No data',
    speakingTimeDetail: 'No audio data',
    dominantEmotionValue: 'Most detected: N/A',
    expressionCountDetail: '0 detected expression types'
  };
}

function getDominantEmotion(emotionCounts: Record<string, number>): string {
  let maxCount = 0;
  let dominantEmotion = 'N/A';

  for (const emotion in emotionCounts) {
    const count = emotionCounts[emotion] ?? 0;
    if (count > maxCount) {
      maxCount = count;
      dominantEmotion = emotion.charAt(0).toUpperCase() + emotion.slice(1);
    }
  }

  return dominantEmotion;
}

function formatDuration(seconds: number | null): string {
  if (seconds === null || !Number.isFinite(seconds) || seconds < 0) {
    return 'No call duration yet';
  }
  const roundedSeconds = Math.round(seconds);
  if (roundedSeconds < 60) {
    return `${Math.max(1, roundedSeconds)}-second call`;
  }
  const minutes = Math.floor(roundedSeconds / 60);
  const remainingSeconds = roundedSeconds % 60;
  return `${minutes}m ${remainingSeconds.toString().padStart(2, '0')}s call`;
}

function formatWholePercent(value: number): string {
  const rounded = Math.max(0, Math.min(100, Math.round(value)));
  return `${rounded}%`;
}

function buildSummaryMetrics(locale: AppLocale): SummaryMetrics {
  if (!DataProcessor.filteredData || DataProcessor.filteredData.length === 0) {
    return fallbackMetrics(locale);
  }

  const emotionCounts = DataProcessor.emotionCounts || {};
  const dominantEmotion = getDominantEmotion(emotionCounts);
  const expressionCount = Object.keys(emotionCounts).length;
  const eyeContactScore = DataProcessor.getGazeCenterPercentage();
  const nodCount = DataProcessor.getNoddingShakingData().nodCount;
  const shoulderVisibility = DataProcessor.getShoulderVisibilityData().visiblePercentage;
  const speakingTime = DataProcessor.getSpeakingTimePercentage();

  return {
    meetingDuration: formatDuration(DataProcessor.getCallDuration()),
    meetingDate: formatMeetingDate(locale),
    eyeContactValue: formatWholePercent(eyeContactScore),
    eyeContactDetail: 'Camera-facing share',
    bodyLanguageValue: `${nodCount} nod ${nodCount === 1 ? 'event' : 'events'}`,
    bodyLanguageDetail: nodCount > 0 ? 'Detected during session' : 'No nods detected during session',
    postureValue: formatWholePercent(shoulderVisibility),
    postureDetail: 'Visible on camera',
    speakingTimeValue: speakingTime !== null ? formatWholePercent(speakingTime) : 'No data',
    speakingTimeDetail: speakingTime !== null ? 'Of call duration' : 'No audio data',
    dominantEmotionValue: `Most detected: ${dominantEmotion}`,
    expressionCountDetail: `${expressionCount} detected expression ${expressionCount === 1 ? 'type' : 'types'}`
  };
}

export function AnalysisSummaryHeader(props: AnalysisSummaryHeaderProps) {
  const { locale, onOpenInsights, dataRevision } = props;
  const metrics = useMemo(() => buildSummaryMetrics(locale), [dataRevision, locale]);
  const [isExporting, setIsExporting] = useState(false);
  const tr = (text: string) => translateUiText(text, locale);

  function handleExportClick(): void {
    if (isExporting) {
      return;
    }
    setIsExporting(true);
    setTimeout(() => {
      window.print();
      setIsExporting(false);
    }, 50);
  }

  return (
    <>
      <div className="navbar">
        <div className="navbar-content">
          <h1>{tr('Analysis Dashboard')}</h1>
          <div className="meeting-meta">
            <span id="meeting-duration">{tr(metrics.meetingDuration)}</span>
            <span id="meeting-date">{metrics.meetingDate}</span>
          </div>
        </div>
      </div>

      <div className="key-insights-section">
        <div className="key-insights-header">
          <h2 className="key-insights-title">{tr('Key Insights')}</h2>
          <div className="key-insights-actions">
            <button
              id="exportAnalysisBtn"
              className="export-analysis-btn"
              type="button"
              onClick={handleExportClick}
              disabled={isExporting}
            >
              <i className="fas fa-file-pdf" />
              {isExporting ? tr('Opening PDF...') : tr('Export PDF')}
            </button>
            <button className="learn-quiz-btn" type="button" onClick={onOpenInsights}>
              <i className="fas fa-graduation-cap" />
              {tr('Learn & Quiz')}
            </button>
          </div>
        </div>

        <div className="key-insights-grid">
          <div className="insight-card eye-contact-card">
            <p className="insight-label">{tr('Eye Contact')}</p>
            <p className="insight-value">{metrics.eyeContactValue}</p>
            <p className="insight-detail">{tr(metrics.eyeContactDetail)}</p>
          </div>
          <div className="insight-card body-language-card">
            <p className="insight-label">{tr('Nodding')}</p>
            <p className="insight-value">{tr(metrics.bodyLanguageValue)}</p>
            <p className="insight-detail">{tr(metrics.bodyLanguageDetail)}</p>
          </div>
          <div className="insight-card posture-card">
            <p className="insight-label">{tr('Shoulder Visibility')}</p>
            <p className="insight-value">{metrics.postureValue}</p>
            <p className="insight-detail">{tr(metrics.postureDetail)}</p>
          </div>
          <div className="insight-card speaking-card">
            <p className="insight-label">{tr('Speaking Time')}</p>
            <p className="insight-value">{tr(metrics.speakingTimeValue)}</p>
            <p className="insight-detail">{tr(metrics.speakingTimeDetail)}</p>
          </div>
          <div className="insight-card expressions-card">
            <p className="insight-label">{tr('Expressions')}</p>
            <p className="insight-value">{tr(metrics.dominantEmotionValue)}</p>
            <p className="insight-detail">{tr(metrics.expressionCountDetail)}</p>
          </div>
        </div>
      </div>
    </>
  );
}
