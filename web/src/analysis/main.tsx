import { useEffect, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { DataProcessor } from './dataProcessor';
import '@fortawesome/fontawesome-free/css/all.min.css';
import './styles.css';
import { AnalysisSummaryHeader } from './summary';
import { EmotionChartsSection } from './emotion-charts';
import { AnalysisInsightsPopup, AnalysisRemainingSections } from './sections';
import { AnalysisLlmPanel } from './llm-panel';
import {
  applyLocaleToDocument,
  getLocaleButtonLabel,
  nextLocale,
  readStoredLocale,
  translateUiText,
  type AppLocale,
  writeStoredLocale
} from '../shared/locale';

function AnalysisApp() {
  const [locale, setLocale] = useState<AppLocale>(() => readStoredLocale());
  const [bootstrapError, setBootstrapError] = useState<string | null>(null);
  const [isInsightsOpen, setIsInsightsOpen] = useState(false);
  const [dataRevision, setDataRevision] = useState(0);
  const tr = (text: string) => translateUiText(text, locale);

  useEffect(() => {
    writeStoredLocale(locale);
    applyLocaleToDocument(locale);
    document.title = locale === 'fi' ? 'Analyysi (React)' : 'Analysis (React)';
  }, [locale]);

  function openInsightsPopup(): void {
    setIsInsightsOpen(true);
  }

  useEffect(() => {
    let isUnmounted = false;
    let beforeUnloadHandler: ((event: BeforeUnloadEvent) => string) | null = null;

    async function bootstrapAnalysis() {
      try {
        if (isUnmounted) {
          return;
        }

        const storedData = sessionStorage.getItem('responseData');
        if (!storedData) {
          setBootstrapError('No analysis data yet. Start a room call and end analysis to populate this page.');
          return;
        }

        let responseData: unknown;
        try {
          responseData = JSON.parse(storedData);
        } catch (error) {
          console.error('Invalid analysis data in session storage:', error);
          sessionStorage.removeItem('responseData');
          setBootstrapError('Saved analysis data was invalid and has been cleared. Run a new analysis session.');
          return;
        }

        if (!Array.isArray(responseData)) {
          sessionStorage.removeItem('responseData');
          setBootstrapError('Saved analysis data was invalid and has been cleared. Run a new analysis session.');
          return;
        }

        const hasValidEntries = responseData.some(item => item !== null && typeof item === 'object');
        if (!hasValidEntries) {
          sessionStorage.removeItem('responseData');
          setBootstrapError('Saved analysis data was invalid and has been cleared. Run a new analysis session.');
          return;
        }

        if (!DataProcessor.init(responseData)) {
          setBootstrapError('Failed to initialize analysis data.');
          return;
        }

        setDataRevision(prev => prev + 1);

        beforeUnloadHandler = (event: BeforeUnloadEvent) => {
          const confirmationMessage = translateUiText(
            'Are you sure you want to leave this page? Any analysis data will be lost.',
            readStoredLocale()
          );
          event.returnValue = confirmationMessage;
          return confirmationMessage;
        };
        window.addEventListener('beforeunload', beforeUnloadHandler);
      } catch (error) {
        if (isUnmounted) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Analysis bootstrap failed.';
        setBootstrapError(message);
      }
    }

    void bootstrapAnalysis();
    return () => {
      isUnmounted = true;
      if (beforeUnloadHandler) {
        window.removeEventListener('beforeunload', beforeUnloadHandler);
      }
    };
  }, []);

  if (bootstrapError) {
    return (
      <>
        <div className="analysis-language-row">
          <button
            type="button"
            className="analysis-language-btn"
            onClick={() => setLocale(current => nextLocale(current))}
          >
            {getLocaleButtonLabel(locale)}
          </button>
        </div>
        <div
          role="alert"
          style={{
            margin: '16px',
            borderRadius: '6px',
            padding: '12px 14px',
            background: '#fef3f2',
            color: '#b42318',
            border: '1px solid #fecdca'
          }}
        >
          {tr(bootstrapError)}
        </div>
      </>
    );
  }

  return (
    <>
      <div className="analysis-language-row">
        <button
          type="button"
          className="analysis-language-btn"
          onClick={() => setLocale(current => nextLocale(current))}
        >
          {getLocaleButtonLabel(locale)}
        </button>
      </div>
      <AnalysisSummaryHeader locale={locale} onOpenInsights={openInsightsPopup} dataRevision={dataRevision} />
      <AnalysisInsightsPopup locale={locale} isOpen={isInsightsOpen} onClose={() => setIsInsightsOpen(false)} />
      <div className="dashboard-container">
        <EmotionChartsSection locale={locale} dataRevision={dataRevision} />
        <AnalysisRemainingSections locale={locale} dataRevision={dataRevision} />
        <AnalysisLlmPanel locale={locale} dataRevision={dataRevision} />
      </div>
    </>
  );
}

const rootElement = document.getElementById('root');
if (!rootElement) {
  throw new Error('Missing #root element');
}

createRoot(rootElement).render(
  <AnalysisApp />
);
