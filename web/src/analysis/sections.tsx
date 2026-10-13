import React, { useEffect, useMemo, useRef, useState } from 'react';
import { DataProcessor, FILLER_WORDS } from './dataProcessor';
import { ChartJS, type Chart } from './chart-runtime';
import {
  getBrowInterpretations,
  getGazeInterpretations,
  getHeadPoseInterpretations,
  getNoddingInterpretations,
  getShoulderInterpretations,
  getTranscriptInterpretations,
  type LabeledInterpretation
} from './interpretations';
import { translateUiText, type AppLocale } from '../shared/locale';

type AnalysisInsightsPopupProps = {
  locale: AppLocale;
  isOpen: boolean;
  onClose: () => void;
};

type QuizQuestionId = 'q1' | 'q2' | 'q3';
type QuizAnswers = Partial<Record<QuizQuestionId, string>>;

type QuizState = {
  submitted: boolean;
  answers: QuizAnswers;
};

const QUIZ_STORAGE_KEY = 'analysisQuizStateV1';

const QUIZ_CORRECT_ANSWERS: Record<QuizQuestionId, string> = {
  q1: 'camera',
  q2: 'rapport',
  q3: 'natural'
};

type TranscriptWord = {
  text: string;
  category: 'filler' | null;
  isFiller: boolean;
};

type TimelinePoint = {
  x: Date;
  y: number | null;
};

function loadQuizState(): QuizState {
  const raw = sessionStorage.getItem(QUIZ_STORAGE_KEY);
  if (!raw) {
    return { submitted: false, answers: {} };
  }

  try {
    const parsed = JSON.parse(raw) as QuizState;
    if (!parsed || typeof parsed !== 'object') {
      return { submitted: false, answers: {} };
    }
    return {
      submitted: parsed.submitted === true,
      answers: parsed.answers && typeof parsed.answers === 'object' ? parsed.answers : {}
    };
  } catch {
    sessionStorage.removeItem(QUIZ_STORAGE_KEY);
    return { submitted: false, answers: {} };
  }
}

function saveQuizState(state: QuizState): void {
  sessionStorage.setItem(QUIZ_STORAGE_KEY, JSON.stringify(state));
}

function countCorrectAnswers(answers: QuizAnswers): number {
  return (Object.keys(QUIZ_CORRECT_ANSWERS) as QuizQuestionId[])
    .filter(questionId => answers[questionId] === QUIZ_CORRECT_ANSWERS[questionId])
    .length;
}

function renderInterpretationList(items: LabeledInterpretation[], emptyText: string, locale: AppLocale) {
  const tr = (text: string) => translateUiText(text, locale);
  if (items.length === 0) {
    return <li>{tr(emptyText)}</li>;
  }

  return items.map(item => (
    <li key={item.label}>
      <strong>{tr(item.label)}:</strong> {tr(item.text)}
    </li>
  ));
}

function extractWordsFromText(text: string): string[] {
  const cleanedText = text
    .replace(/<\|[^|>]+?\|>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const processedText = cleanedText
    .replace(/([.!?])([A-ZÄÖÅ])/g, '$1 $2')
    .replace(/([a-zäöå])([.!?])([a-zäöå])/gi, '$1$2 $3');
  return processedText.split(/\s+/).filter(word => word.trim().length > 0);
}

function normalizeTranscriptWord(word: string): string {
  return word
    .toLowerCase()
    .replace(/^[^a-zA-ZäöåÄÖÅ]+/, '')
    .replace(/[^a-zA-ZäöåÄÖÅ]+$/, '');
}

function TranscriptInteractivePanel(props: DataPanelProps) {
  const { locale, dataRevision } = props;
  const [words, setWords] = useState<TranscriptWord[]>([]);
  const [blinkIndex, setBlinkIndex] = useState<number | null>(null);
  const blinkTimeoutRef = useRef<number | null>(null);
  const tr = (text: string) => translateUiText(text, locale);

  useEffect(() => {
    if (dataRevision <= 0) {
      setWords([]);
      setBlinkIndex(null);
      return;
    }

    const text = DataProcessor.getSpeechText();
    const parsedWords = extractWordsFromText(text);
    const transcriptData: TranscriptWord[] = parsedWords.map(word => ({
      text: word,
      category: null,
      isFiller: FILLER_WORDS.includes(normalizeTranscriptWord(word))
    }));
    setWords(transcriptData);
    setBlinkIndex(null);
  }, [dataRevision]);

  useEffect(() => {
    return () => {
      if (blinkTimeoutRef.current !== null) {
        window.clearTimeout(blinkTimeoutRef.current);
      }
    };
  }, []);

  const totalFillers = useMemo(
    () => words.filter(word => word.isFiller).length,
    [words]
  );
  const foundFillers = useMemo(
    () => words.filter(word => word.category === 'filler' && word.isFiller).length,
    [words]
  );
  const isComplete = totalFillers > 0 && foundFillers === totalFillers;

  function handleWordClick(index: number): void {
    const wordData = words[index];
    if (!wordData) {
      return;
    }

    if (wordData.category === 'filler') {
      return;
    }

    if (wordData.isFiller) {
      setWords(prev => prev.map((word, wordIndex) => (
        wordIndex === index
          ? { ...word, category: 'filler' }
          : word
      )));
      return;
    }

    if (blinkTimeoutRef.current !== null) {
      window.clearTimeout(blinkTimeoutRef.current);
    }
    setBlinkIndex(index);
    blinkTimeoutRef.current = window.setTimeout(() => {
      setBlinkIndex(null);
      blinkTimeoutRef.current = null;
    }, 260);
  }

  const instructionsText = totalFillers === 0
    ? 'No filler words detected in the transcript.'
    : `Click the filler words you detect. Find all ${totalFillers} filler words in your transcript.`;

  let counterText = '';
  if (totalFillers > 0) {
    if (isComplete) {
      counterText = `Found ${foundFillers} of ${totalFillers} filler words - All detected filler words are marked.`;
    } else {
      counterText = `Found ${foundFillers} of ${totalFillers} filler words`;
    }
  }

  return (
    <div>
      <div className="transcript-instructions">{tr(instructionsText)}</div>

      <div className="transcript-text">
        {words.map((word, index) => {
          const classNames = ['transcript-word'];
          if (word.category === 'filler' && word.isFiller) {
            classNames.push('categorized-filler-correct');
          } else if (blinkIndex === index) {
            classNames.push('incorrect-blink');
          }

          return (
            <React.Fragment key={`${word.text}-${index}`}>
              <span
                className={classNames.join(' ')}
                onClick={() => handleWordClick(index)}
              >
                {word.text}
              </span>
              {index < words.length - 1 ? ' ' : null}
            </React.Fragment>
          );
        })}
      </div>

      {totalFillers > 0 ? (
        <div className="filler-counter">
          <span>{tr(counterText)}</span>
        </div>
      ) : null}
    </div>
  );
}

function SpeechVisualPanel(props: DataPanelProps) {
  const { locale, dataRevision } = props;
  const tr = (text: string) => translateUiText(text, locale);

  const speechData = useMemo(() => {
    if (dataRevision <= 0) {
      return {
        speakingTimePercentage: null as number | null,
        topFillers: [] as Array<{ word: string; count: number }>,
        fillerWordCount: 0,
        openEndedQuestionCount: 0,
        questionExamples: [] as string[]
      };
    }

    const markers = DataProcessor.getSpeechMarkers();
    return {
      speakingTimePercentage: DataProcessor.getSpeakingTimePercentage(),
      topFillers: markers?.topFillers || [],
      fillerWordCount: markers?.fillerWordCount || 0,
      openEndedQuestionCount: markers?.openEndedQuestionCount || 0,
      questionExamples: markers?.questionExamples || []
    };
  }, [dataRevision]);
  const speakingTimePercentage = speechData.speakingTimePercentage === null
    ? null
    : Math.max(0, Math.min(100, Math.round(speechData.speakingTimePercentage)));

  return (
    <div className="speech-visual-panel">
      <div className="speech-visual-card">
        <h4>{tr('Speaking time')}</h4>
        <div className="speech-visual-value">
          {speakingTimePercentage === null ? tr('No data') : `${speakingTimePercentage}%`}
        </div>
        <div className="speech-metric-track">
          <div
            className="speech-metric-fill"
            style={{ width: `${speakingTimePercentage === null ? 0 : speakingTimePercentage}%` }}
          />
        </div>
      </div>

      <div className="speech-visual-card">
        <h4>{tr('Filler words')}</h4>
        <div className="speech-metric-list">
          {speechData.topFillers.length === 0 ? (
            <div className="visual-empty-state">{tr('No filler words detected')}</div>
          ) : (
            speechData.topFillers.map(filler => {
              const ratio = speechData.fillerWordCount > 0
                ? Math.round((filler.count / speechData.fillerWordCount) * 100)
                : 0;
              return (
                <div className="speech-metric-item" key={filler.word}>
                  <div className="speech-metric-row">
                    <span>{filler.word}</span>
                    <span>{filler.count}</span>
                  </div>
                  <div className="speech-metric-track">
                    <div className="speech-metric-fill" style={{ width: `${ratio}%` }} />
                  </div>
                </div>
              );
            })
          )}
        </div>
      </div>

      <div className="speech-visual-card">
        <h4>{tr('Open-ended questions')}</h4>
        <div className="speech-visual-value">{speechData.openEndedQuestionCount}</div>
        {speechData.questionExamples.length > 0 ? (
          <ul className="speech-question-list">
            {speechData.questionExamples.slice(0, 3).map(example => (
              <li key={example}>{example}</li>
            ))}
          </ul>
        ) : null}
      </div>
    </div>
  );
}

export function AnalysisInsightsPopup(props: AnalysisInsightsPopupProps) {
  const { locale, isOpen, onClose } = props;
  const [quizState, setQuizState] = useState<QuizState>({ submitted: false, answers: {} });
  const tr = (text: string) => translateUiText(text, locale);

  useEffect(() => {
    setQuizState(loadQuizState());
  }, []);

  const correctCount = useMemo(
    () => countCorrectAnswers(quizState.answers),
    [quizState.answers]
  );

  function handleOverlayClick(event: React.MouseEvent<HTMLDivElement>): void {
    if (event.target === event.currentTarget) {
      onClose();
    }
  }

  function handleAnswerChange(questionId: QuizQuestionId, value: string): void {
    const nextState: QuizState = {
      submitted: false,
      answers: {
        ...quizState.answers,
        [questionId]: value
      }
    };
    setQuizState(nextState);
    saveQuizState(nextState);
  }

  function handleSubmitQuiz(): void {
    const nextState: QuizState = {
      submitted: true,
      answers: quizState.answers
    };
    setQuizState(nextState);
    saveQuizState(nextState);
  }

  function getFeedback(questionId: QuizQuestionId): { text: string; className: string } {
    if (!quizState.submitted) {
      return { text: '', className: 'answer-feedback' };
    }

    const answer = quizState.answers[questionId];
    if (!answer) {
      return { text: 'Select an answer to continue', className: 'answer-feedback incorrect' };
    }

    if (answer === QUIZ_CORRECT_ANSWERS[questionId]) {
      return { text: '✓ Correct!', className: 'answer-feedback correct' };
    }

    return { text: 'Try another option', className: 'answer-feedback incorrect' };
  }

  function getResults(): { text: string; className: string } {
    if (!quizState.submitted) {
      return { text: '', className: 'quiz-results' };
    }

    const totalQuestions = Object.keys(QUIZ_CORRECT_ANSWERS).length;

    if (correctCount === totalQuestions) {
      return {
        text: `${correctCount}/${totalQuestions} correct.`,
        className: 'quiz-results correct'
      };
    }

    if (correctCount >= totalQuestions / 2) {
      return {
        text: `${correctCount}/${totalQuestions} correct.`,
        className: 'quiz-results partial'
      };
    }

    return {
      text: `${correctCount}/${totalQuestions} correct. Review the information above and try again if needed.`,
      className: 'quiz-results incorrect'
    };
  }

  const q1Feedback = getFeedback('q1');
  const q2Feedback = getFeedback('q2');
  const q3Feedback = getFeedback('q3');
  const results = getResults();

  return (
    <div
      id="key-insights-popup"
      className="popup"
      style={{ display: isOpen ? 'block' : 'none' }}
      onClick={handleOverlayClick}
    >
      <div className="popup-content">
        <button className="close-btn" type="button" aria-label={tr('Close key insights information')} onClick={onClose}>&times;</button>
        <h2>{tr('Key Insights Information')}</h2>

        <div className="insight-info-section">
          <h3>{tr('Eye Contact in Telehealth')}</h3>

          <div className="info-section">
            <p>
              {tr('In video consultations, looking at the camera generally creates stronger eye-contact cues than looking at the screen.')}
            </p>
          </div>

          <details className="insight-disclosure quiz-disclosure">
            <summary className="insight-disclosure-summary insight-disclosure-summary-quiz">
              <span className="summary-main">
                <i className="fas fa-play-circle" aria-hidden="true" />
                {tr('Start Quiz')}
              </span>
              <span className="summary-sub">{tr('3 questions')}</span>
            </summary>
            <div className="quiz-section">
              <div className="quiz-question">
                <p className="question-text">{tr('1. In video consultations, where should healthcare providers look to maintain proper eye contact?')}</p>
                <div className="quiz-options">
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q1"
                      value="screen"
                      checked={quizState.answers.q1 === 'screen'}
                      onChange={event => handleAnswerChange('q1', event.target.value)}
                    />
                    <span>{tr('At the notes located on the desk')}</span>
                  </label>
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q1"
                      value="camera"
                      checked={quizState.answers.q1 === 'camera'}
                      onChange={event => handleAnswerChange('q1', event.target.value)}
                    />
                    <span>{tr("Directly at the camera lens or patient's face on the screen")}</span>
                  </label>
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q1"
                      value="window"
                      checked={quizState.answers.q1 === 'window'}
                      onChange={event => handleAnswerChange('q1', event.target.value)}
                    />
                    <span>{tr('Out the window for a natural look')}</span>
                  </label>
                </div>
                <div className={q1Feedback.className}>{tr(q1Feedback.text)}</div>
              </div>

              <div className="quiz-question">
                <p className="question-text">{tr('2. Why is eye contact particularly important in telehealth settings?')}</p>
                <div className="quiz-options">
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q2"
                      value="technical"
                      checked={quizState.answers.q2 === 'technical'}
                      onChange={event => handleAnswerChange('q2', event.target.value)}
                    />
                    <span>{tr('It helps with video connection quality')}</span>
                  </label>
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q2"
                      value="rapport"
                      checked={quizState.answers.q2 === 'rapport'}
                      onChange={event => handleAnswerChange('q2', event.target.value)}
                    />
                    <span>{tr('It helps establish rapport and trust with patients')}</span>
                  </label>
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q2"
                      value="documentation"
                      checked={quizState.answers.q2 === 'documentation'}
                      onChange={event => handleAnswerChange('q2', event.target.value)}
                    />
                    <span>{tr('It makes consultations easier to record')}</span>
                  </label>
                </div>
                <div className={q2Feedback.className}>{tr(q2Feedback.text)}</div>
              </div>

              <div className="quiz-question">
                <p className="question-text">{tr('3. What does research suggest about eye contact in telemedicine consultations?')}</p>
                <div className="quiz-options">
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q3"
                      value="avoid"
                      checked={quizState.answers.q3 === 'avoid'}
                      onChange={event => handleAnswerChange('q3', event.target.value)}
                    />
                    <span>{tr('Eye contact should be avoided to focus on notes')}</span>
                  </label>
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q3"
                      value="natural"
                      checked={quizState.answers.q3 === 'natural'}
                      onChange={event => handleAnswerChange('q3', event.target.value)}
                    />
                    <span>{tr('Natural eye contact patterns work best')}</span>
                  </label>
                  <label className="quiz-option">
                    <input
                      type="radio"
                      name="q3"
                      value="exaggerated"
                      checked={quizState.answers.q3 === 'exaggerated'}
                      onChange={event => handleAnswerChange('q3', event.target.value)}
                    />
                    <span>{tr('Eye contact should be exaggerated compared to in-person visits')}</span>
                  </label>
                </div>
                <div className={q3Feedback.className}>{tr(q3Feedback.text)}</div>
              </div>

              <button className="quiz-submit-btn" onClick={handleSubmitQuiz}>{tr('Check Answers')}</button>
              <div className={results.className}>{tr(results.text)}</div>
            </div>
          </details>
        </div>

        <div className="insight-info-section">
          <h3>{tr('Nodding in Telehealth')}</h3>
          <p>
            {tr("Nodding is an important non-verbal cue that indicates active listening and agreement. In telehealth settings, deliberate nodding can help establish rapport with patients and show that you're engaged in the conversation.")}
          </p>
        </div>

        <div className="insight-info-section">
          <h3>{tr('Shoulder Visibility in Telehealth')}</h3>
          <p>
            {tr('Maintaining good posture with visible shoulders indicates professionalism and attentiveness. Proper framing in the camera with visible shoulders creates a more engaging presence during video consultations.')}
          </p>
        </div>

        <div className="insight-info-section">
          <h3>{tr('Speaking Time in Telehealth')}</h3>
          <p>
            {tr('The balance between speaking and listening is crucial in effective telehealth communication. Ideally, healthcare providers should aim for a balanced conversation that allows patients sufficient time to express concerns while also providing clear guidance and information.')}
          </p>
          <p>
            {tr('Research suggests that patient-centered communication, where the provider does not dominate the conversation, leads to better patient satisfaction and outcomes.')}
          </p>
        </div>

        <div className="insight-info-section">
          <h3>{tr('Facial Expressions in Telehealth')}</h3>
          <p>
            {tr('Using varied facial expressions in telehealth shows active participation in the conversation. Computer-mediated communication filters some of the nonverbal behaviors that may influence the empathy conveyed in remote consultations. Exaggeration of nonverbal behavior has been identified in telehealth communication research as a potentially useful way to convey empathy to patients.')}
          </p>
        </div>

        <details className="insight-disclosure sources-disclosure">
          <summary className="insight-disclosure-summary">{tr('Sources')}</summary>
          <ol className="sources-list">
            <li>
              Helou S, El Helou E, Evans N, Shigematsu T, El Helou J, Kaneko M, et al.
              <em> Physician eye contact in telemedicine video consultations: A cross-cultural experiment</em>.
              International Journal of Medical Informatics 2022;165:104825.
              <a href="https://doi.org/10.1016/j.ijmedinf.2022.104825" target="_blank"> DOI 10.1016/j.ijmedinf.2022.104825</a>
            </li>
            <li>
              Meuter LS, Wolf KI, Pacak K.
              <em> Maintaining Professional Encounters and Enhancing Telemedicine Interactions With Core Virtual-Clinical Values</em>.
              Endocrine Practice 2021;27:77-79.
              <a href="https://doi.org/10.1016/j.eprac.2020.11.006" target="_blank"> DOI 10.1016/j.eprac.2020.11.006</a>
            </li>
            <li>
              Grondin F, Lomanowska AM, Jackson PL.
              <em> Empathy in computer-mediated interactions: A conceptual framework for research and clinical practice</em>.
              Clinical Psychology: Science and Practice 2019;26:17-17.
              <a href="https://doi.org/10.1111/cpsp.12298" target="_blank"> DOI 10.1111/cpsp.12298</a>
            </li>
          </ol>
        </details>
      </div>
    </div>
  );
}

type DirectionSectionProps = {
  locale: AppLocale;
  title: string;
  directionType: 'gaze' | 'head';
  interpretationItems: string[];
  dataRevision: number;
};

type DirectionBreakdown = {
  percentages: Record<string, number>;
  total: number;
};

type DirectionConfigItem = {
  key: string;
  label: string;
};

type DirectionConfig = {
  center: DirectionConfigItem;
  left: DirectionConfigItem;
  right: DirectionConfigItem;
  up: DirectionConfigItem;
  down: DirectionConfigItem;
};

type SegmentContext = {
  p0: { parsed: { y: number | null } };
  p1: { parsed: { y: number | null } };
};

type DirectionLabelMap = Record<number, { name: string; dataKey: string }>;

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = Math.max(0, Math.floor(seconds) % 60);
  return `${minutes.toString().padStart(2, '0')}:${remainingSeconds.toString().padStart(2, '0')}`;
}

function getDirectionColor(value: number | null | undefined): string {
  if (value === null || value === undefined) {
    return 'rgba(0, 0, 0, 0)';
  }
  if (value === 4) {
    return 'rgba(54, 162, 235, 1)';
  }
  if (value === 1 || value === 0) {
    return 'rgba(153, 102, 255, 1)';
  }
  if (value === 3 || value === 2) {
    return 'rgba(75, 192, 192, 1)';
  }
  return 'rgba(59, 130, 246, 1)';
}

function DirectionTimelineChart(props: { locale: AppLocale; dataRevision: number; directionType: 'gaze' | 'head' }) {
  const { locale, dataRevision, directionType } = props;
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const chartRef = useRef<Chart<'line', TimelinePoint[]> | null>(null);
  const [hasData, setHasData] = useState(true);
  const tr = (text: string) => translateUiText(text, locale);

  useEffect(() => {
    if (dataRevision <= 0) {
      return;
    }

    const canvas = canvasRef.current;
    if (!canvas) {
      return;
    }

    const breakdown = directionType === 'gaze'
      ? DataProcessor.getGazeBreakdown()
      : DataProcessor.getHeadPoseBreakdown();
    const timelineData = (directionType === 'gaze'
      ? DataProcessor.getGazeDataForTimeline()
      : DataProcessor.getHeadPoseDataForTimeline()) as TimelinePoint[];
    const hasTimelineData = breakdown.total > 0 && timelineData.length > 0;
    setHasData(hasTimelineData);

    if (!hasTimelineData) {
      if (chartRef.current) {
        chartRef.current.destroy();
        chartRef.current = null;
      }
      return;
    }

    if (chartRef.current) {
      chartRef.current.destroy();
      chartRef.current = null;
    }

    const directionMap: DirectionLabelMap = directionType === 'gaze'
      ? {
        4: { name: 'Center', dataKey: 'Gaze center' },
        3: { name: 'Right', dataKey: 'Gaze right' },
        2: { name: 'Left', dataKey: 'Gaze left' },
        1: { name: 'Up', dataKey: 'Gaze up' },
        0: { name: 'Down', dataKey: 'Gaze down' }
      }
      : {
        4: { name: 'Forward', dataKey: 'Forward' },
        3: { name: 'Right', dataKey: 'Looking Right' },
        2: { name: 'Left', dataKey: 'Looking Left' },
        1: { name: 'Up', dataKey: 'Looking Up' },
        0: { name: 'Down', dataKey: 'Looking Down' }
      };

    chartRef.current = new ChartJS(canvas, {
      type: 'line',
      data: {
        datasets: [{
          label: directionType === 'gaze' ? tr('Gaze Direction') : tr('Head Pose'),
          data: timelineData,
          segment: {
            borderColor: (ctx: SegmentContext) => {
              const p0y = ctx.p0.parsed.y;
              const p1y = ctx.p1.parsed.y;
              if (p0y === p1y) {
                return getDirectionColor(p1y);
              }
              return 'rgba(0, 0, 0, 0)';
            },
            borderWidth: (ctx: SegmentContext) => {
              const p0y = ctx.p0.parsed.y;
              const p1y = ctx.p1.parsed.y;
              return p0y === p1y ? 12 : 0;
            }
          },
          borderWidth: 12,
          clip: false,
          pointRadius: 0,
          pointHoverRadius: 0,
          fill: false,
          spanGaps: false
        }]
      },
      options: {
        responsive: true,
        maintainAspectRatio: false,
        scales: {
          x: {
            type: 'time',
            time: {
              unit: 'second',
              displayFormats: {
                second: 'mm:ss'
              }
            },
            title: {
              display: true,
              text: tr('Time (mm:ss)')
            },
            ticks: {
              stepSize: 30,
              callback: (value: unknown) => {
                const seconds = Number(value) / 1000;
                if (Number.isFinite(seconds) && seconds % 30 === 0) {
                  return formatSeconds(seconds);
                }
                return '';
              }
            }
          },
          y: {
            min: 0,
            max: 4,
            ticks: {
              stepSize: 1,
              callback: (value: unknown) => {
                const direction = directionMap[Number(value)];
                if (!direction) {
                  return '';
                }
                return tr(direction.name);
              }
            }
          }
        },
        plugins: {
          legend: {
            display: false
          },
          datalabels: {
            display: false
          },
          tooltip: {
            enabled: false
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
  }, [dataRevision, directionType, locale]);

  if (!hasData) {
    return (
      <div className="visual-empty-state">
        {tr(`No ${directionType} direction data detected`)}
      </div>
    );
  }

  return <canvas ref={canvasRef} className="direction-timeline-canvas" />;
}

function DirectionHeatGridPanel(props: { locale: AppLocale; dataRevision: number; directionType: 'gaze' | 'head' }) {
  const { locale, dataRevision, directionType } = props;
  const tr = (text: string) => translateUiText(text, locale);
  const breakdown = useMemo<DirectionBreakdown>(() => {
    if (dataRevision <= 0) {
      return { percentages: {}, total: 0 };
    }
    return directionType === 'gaze'
      ? DataProcessor.getGazeBreakdown()
      : DataProcessor.getHeadPoseBreakdown();
  }, [dataRevision, directionType]);

  const directionConfig: DirectionConfig = directionType === 'gaze'
    ? {
      center: { key: 'Gaze center', label: tr('Center') },
      left: { key: 'Gaze left', label: tr('Left') },
      right: { key: 'Gaze right', label: tr('Right') },
      up: { key: 'Gaze up', label: tr('Up') },
      down: { key: 'Gaze down', label: tr('Down') }
    }
    : {
      center: { key: 'Forward', label: tr('Forward') },
      left: { key: 'Looking Left', label: tr('Left') },
      right: { key: 'Looking Right', label: tr('Right') },
      up: { key: 'Looking Up', label: tr('Up') },
      down: { key: 'Looking Down', label: tr('Down') }
    };

  if (!breakdown.total) {
    return (
      <div className="visual-empty-state">
        {tr(`No ${directionType} direction data detected`)}
      </div>
    );
  }

  const directionStats = {
    up: {
      ...directionConfig.up,
      percentage: breakdown.percentages[directionConfig.up.key] || 0
    },
    left: {
      ...directionConfig.left,
      percentage: breakdown.percentages[directionConfig.left.key] || 0
    },
    center: {
      ...directionConfig.center,
      percentage: breakdown.percentages[directionConfig.center.key] || 0
    },
    right: {
      ...directionConfig.right,
      percentage: breakdown.percentages[directionConfig.right.key] || 0
    },
    down: {
      ...directionConfig.down,
      percentage: breakdown.percentages[directionConfig.down.key] || 0
    }
  };

  const order: Array<keyof typeof directionStats> = ['center', 'left', 'right', 'up', 'down'];
  let dominantPosition = order[0];
  order.forEach(position => {
    if (directionStats[position].percentage > directionStats[dominantPosition].percentage) {
      dominantPosition = position;
    }
  });

  const cellOrder: Array<keyof typeof directionStats | null> = [
    null, 'up', null,
    'left', 'center', 'right',
    null, 'down', null
  ];

  return (
    <div className="direction-heat-panel">
      <div className="direction-heat-grid">
        {cellOrder.map((position, index) => {
          if (!position) {
            return <div className="direction-heat-cell direction-heat-cell-empty" key={`empty-${index}`} />;
          }

          const direction = directionStats[position];
          const intensity = Math.max(0.12, direction.percentage / 100);
          const alpha = (0.2 + intensity * 0.7).toFixed(2);
          const isDominant = position === dominantPosition;
          const percentage = Math.round(direction.percentage);

          return (
            <div
              className={`direction-heat-cell ${isDominant ? 'is-dominant' : ''}`}
              key={position}
              style={{
                backgroundColor: `rgba(37, 99, 235, ${alpha})`,
                color: direction.percentage >= 45 ? '#ffffff' : '#0f172a'
              }}
            >
              <span className="direction-heat-cell-label">{direction.label}</span>
              <span className="direction-heat-cell-value">{percentage}%</span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

function DirectionSection(props: DirectionSectionProps) {
  const { locale, title, directionType, interpretationItems, dataRevision } = props;
  const [currentPage, setCurrentPage] = useState(directionType === 'head' ? 1 : 0);
  const tr = (text: string) => translateUiText(text, locale);

  function showPreviousPage() {
    setCurrentPage(prev => (prev - 1 + 2) % 2);
  }

  function showNextPage() {
    setCurrentPage(prev => (prev + 1) % 2);
  }

  return (
    <div className="chart-box line-chart-container card-pager" data-revision={dataRevision}>
      <div className="card-pager-header">
        <h2 className="chart-title">{tr(title)}</h2>
        <div className="card-pager-controls">
          <button className="pager-btn pager-btn-prev" type="button" aria-label={tr('Previous page')} onClick={showPreviousPage}>
            <i className="fas fa-chevron-left" />
          </button>
          <span className="card-pager-indicator">{currentPage + 1} / 2</span>
          <button className="pager-btn pager-btn-next" type="button" aria-label={tr('Next page')} onClick={showNextPage}>
            <i className="fas fa-chevron-right" />
          </button>
        </div>
      </div>
      <div className="card-pager-pages">
        <div className={`card-page ${currentPage === 0 ? 'is-active' : ''}`} data-page-label={tr('Timeline')}>
          <div className="chart-container">
            <DirectionTimelineChart locale={locale} dataRevision={dataRevision} directionType={directionType} />
          </div>
        </div>
        <div className={`card-page ${currentPage === 1 ? 'is-active' : ''}`} data-page-label={tr('Heat grid')}>
          <div className="chart-container">
            <DirectionHeatGridPanel locale={locale} dataRevision={dataRevision} directionType={directionType} />
          </div>
        </div>
      </div>
      <details className="learn-more-disclosure">
        <summary className="learn-more-summary">{tr('Learn more ▾')}</summary>
        <div className="learn-more-content">
          <h3>{tr('How to read this')}</h3>
          <ul>
            {interpretationItems.map(item => (
              <li key={item}>{tr(item)}</li>
            ))}
          </ul>
        </div>
      </details>
    </div>
  );
}

type DataPanelProps = {
  locale: AppLocale;
  dataRevision: number;
};

function ShoulderVisibilityPanel(props: DataPanelProps) {
  const { locale, dataRevision } = props;
  const tr = (text: string) => translateUiText(text, locale);
  const visiblePercentage = useMemo(() => {
    if (dataRevision <= 0) {
      return 0;
    }
    const value = Math.round(DataProcessor.getShoulderVisibilityData().visiblePercentage);
    return Math.max(0, Math.min(100, value));
  }, [dataRevision]);

  return (
    <>
      <div className="shoulder-progress-label">
        {tr(`Shoulders visible: ${visiblePercentage}% of the time`)}
      </div>
      <div className="shoulder-progress-bar-outer" style={{ ['--shoulder-progress' as string]: String(visiblePercentage) }}>
        <div className="shoulder-progress-bar-inner" style={{ width: `${visiblePercentage}%` }} />
      </div>
    </>
  );
}

function NoddingBadgesPanel(props: DataPanelProps) {
  const { locale, dataRevision } = props;
  const tr = (text: string) => translateUiText(text, locale);
  const { nodCount, shakeCount } = useMemo(() => {
    if (dataRevision <= 0) {
      return { nodCount: 0, shakeCount: 0 };
    }
    return DataProcessor.getNoddingShakingData();
  }, [dataRevision]);

  return (
    <div className="nodding-badges-panel">
      <div className="nodding-badge nodding-badge-nod">
        <i className="fas fa-check-circle" />
        <span className="nodding-badge-label">{tr('Nodding events')}</span>
        <span className="nodding-badge-count">{nodCount}</span>
      </div>
      <div className="nodding-badge nodding-badge-shake">
        <i className="fas fa-arrows-left-right" />
        <span className="nodding-badge-label">{tr('Shaking events')}</span>
        <span className="nodding-badge-count">{shakeCount}</span>
      </div>
    </div>
  );
}

function BrowSummaryPanel(props: DataPanelProps) {
  const { locale, dataRevision } = props;
  const tr = (text: string) => translateUiText(text, locale);
  const metrics = useMemo(() => {
    if (dataRevision <= 0) {
      return [];
    }

    const browData = DataProcessor.getBrowData();
    const totalFrames = browData.totalBrowData || 0;
    if (totalFrames === 0) {
      return [];
    }

    return [
      { label: 'Relaxed', value: Math.round(Number(browData.neutralPercentage)), color: '#10b981' },
      { label: 'Raised', value: Math.round(Number(browData.raisedPercentage)), color: '#3b82f6' },
      { label: 'Lowered', value: Math.round(Number(browData.loweredPercentage)), color: '#6366f1' }
    ];
  }, [dataRevision]);

  if (metrics.length === 0) {
    return <div className="visual-empty-state">{tr('No brow movement data detected')}</div>;
  }

  return (
    <div className="brow-metric-list">
      {metrics.map(metric => (
        <div className="brow-metric-row" key={metric.label}>
          <div className="brow-metric-head">
            <span>{tr(metric.label)}</span>
            <span>{metric.value}%</span>
          </div>
          <div className="brow-metric-track">
            <div className="brow-metric-fill" style={{ width: `${metric.value}%`, background: metric.color }} />
          </div>
        </div>
      ))}
    </div>
  );
}

type AnalysisRemainingSectionsProps = {
  locale: AppLocale;
  dataRevision: number;
};

export function AnalysisRemainingSections(props: AnalysisRemainingSectionsProps) {
  const { locale, dataRevision } = props;
  const [transcriptPage, setTranscriptPage] = useState(0);
  const tr = (text: string) => translateUiText(text, locale);

  const gazeInterpretations = getGazeInterpretations();
  const headInterpretations = getHeadPoseInterpretations();
  const transcriptInterpretations = getTranscriptInterpretations();
  const shoulderInterpretations = getShoulderInterpretations();
  const noddingInterpretations = getNoddingInterpretations();
  const browInterpretations = getBrowInterpretations();

  function showPreviousTranscriptPage() {
    setTranscriptPage(prev => (prev - 1 + 2) % 2);
  }

  function showNextTranscriptPage() {
    setTranscriptPage(prev => (prev + 1) % 2);
  }

  return (
    <>
      <DirectionSection
        locale={locale}
        title="Gaze direction"
        directionType="gaze"
        interpretationItems={gazeInterpretations}
        dataRevision={dataRevision}
      />

      <DirectionSection
        locale={locale}
        title="Head direction"
        directionType="head"
        interpretationItems={headInterpretations}
        dataRevision={dataRevision}
      />

      <div className="chart-box" data-revision={dataRevision}>
        <div className="card-pager transcript-pager">
          <div className="card-pager-header">
            <h2 className="chart-title">{tr('Transcript Analysis')}</h2>
            <div className="card-pager-controls">
              <button className="pager-btn pager-btn-prev" type="button" aria-label={tr('Previous page')} onClick={showPreviousTranscriptPage}>
                <i className="fas fa-chevron-left" />
              </button>
              <span className="card-pager-indicator">{transcriptPage + 1} / 2</span>
              <button className="pager-btn pager-btn-next" type="button" aria-label={tr('Next page')} onClick={showNextTranscriptPage}>
                <i className="fas fa-chevron-right" />
              </button>
            </div>
          </div>
          <div className="card-pager-pages">
            <div className={`card-page ${transcriptPage === 0 ? 'is-active' : ''}`} data-page-label={tr('Interactive transcript')}>
              <TranscriptInteractivePanel locale={locale} dataRevision={dataRevision} />
            </div>
            <div className={`card-page ${transcriptPage === 1 ? 'is-active' : ''}`} data-page-label={tr('Speech markers')}>
              <SpeechVisualPanel locale={locale} dataRevision={dataRevision} />
            </div>
          </div>
        </div>
        <details className="learn-more-disclosure">
          <summary className="learn-more-summary">{tr('Learn more ▾')}</summary>
          <div className="learn-more-content">
            <h3>{tr('What this means')}</h3>
            <ul>
              {transcriptInterpretations.map(item => (
                <li key={item}>{tr(item)}</li>
              ))}
            </ul>
          </div>
        </details>
      </div>

      <div className="chart-box posture-visual-box" data-revision={dataRevision}>
        <div className="shoulder-header-row">
          <h2 className="chart-title">{tr('Shoulder Visibility')}</h2>
        </div>
        <div className="shoulder-progress-row">
          <ShoulderVisibilityPanel locale={locale} dataRevision={dataRevision} />
          <div className="shoulder-progress-scale" aria-hidden="true">
            <span>0%</span>
            <span>50%</span>
            <span>100%</span>
          </div>
        </div>
        <details className="learn-more-disclosure">
          <summary className="learn-more-summary">{tr('Learn more ▾')}</summary>
          <div className="learn-more-content">
            <h3>{tr('What this means')}</h3>
            <ul>
              {renderInterpretationList(shoulderInterpretations, 'No shoulder interpretation available', locale)}
            </ul>
          </div>
        </details>
      </div>

      <div className="chart-box" data-revision={dataRevision}>
        <div className="side-by-side-container">
          <div className="half-width-chart">
            <h2 className="chart-title">{tr('Nodding & Shaking')}</h2>
            <div className="chart-container">
              <NoddingBadgesPanel locale={locale} dataRevision={dataRevision} />
            </div>
            <details className="learn-more-disclosure">
              <summary className="learn-more-summary">{tr('Learn more ▾')}</summary>
              <div className="learn-more-content">
                <h3>{tr('What this suggests')}</h3>
                <ul>
                  {renderInterpretationList(noddingInterpretations, 'No nodding interpretation available', locale)}
                </ul>
              </div>
            </details>
          </div>

          <div className="half-width-chart">
            <h2 className="chart-title">{tr('Brow movement')}</h2>
            <div className="chart-container">
              <div className="brow-simple-panel">
                <BrowSummaryPanel locale={locale} dataRevision={dataRevision} />
              </div>
            </div>
            <details className="learn-more-disclosure">
              <summary className="learn-more-summary">{tr('Learn more ▾')}</summary>
              <div className="learn-more-content">
                <h3>{tr('How to read this')}</h3>
                <ul>
                  {renderInterpretationList(browInterpretations, 'No brow interpretation available', locale)}
                </ul>
              </div>
            </details>
          </div>
        </div>
      </div>

    </>
  );
}
