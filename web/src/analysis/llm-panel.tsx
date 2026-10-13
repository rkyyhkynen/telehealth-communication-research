import { useEffect, useMemo, useState } from 'react';
import { DataProcessor } from './dataProcessor';
import { API_BASE_URL } from '../shared/apiBaseUrl';
import type { AnalysisPayload } from '../shared/analysisPayload';
import { translateUiText, type AppLocale } from '../shared/locale';

type AnalysisResult = {
  headline?: string;
  analysis?: string;
  recommendations?: string[];
};

type ChatMessage = {
  role: 'assistant' | 'user';
  content: string;
};

const LLM_CHAT_MAX_ITEMS = 20;

export function AnalysisLlmPanel(props: { locale: AppLocale; dataRevision: number }) {
  const { locale, dataRevision } = props;
  const [status, setStatus] = useState<'idle' | 'loading' | 'ready' | 'error'>('idle');
  const [statusMessage, setStatusMessage] = useState('Waiting for AI analysis...');
  const [analysis, setAnalysis] = useState<AnalysisResult | null>(null);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [chatInput, setChatInput] = useState('');
  const [isSending, setIsSending] = useState(false);
  const tr = (text: string) => translateUiText(text, locale);

  const features = useMemo<AnalysisPayload>(
    () => DataProcessor.getLLMFeaturePayload(),
    [dataRevision]
  );

  useEffect(() => {
    let cancelled = false;

    async function loadAnalysis() {
      if (!DataProcessor.filteredData || DataProcessor.filteredData.length === 0) {
        setStatus('error');
        setStatusMessage('No data available for AI analysis.');
        return;
      }

      setStatus('loading');
      setStatusMessage('Requesting AI interpretation...');

      try {
        const response = await fetch(`${API_BASE_URL}/llm-analysis`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ features, locale })
        });

        const payload = await response.json() as { analysis?: AnalysisResult; error?: string };
        if (!response.ok || !payload.analysis) {
          throw new Error(payload.error || 'LLM analysis unavailable.');
        }

        if (cancelled) {
          return;
        }

        setAnalysis(payload.analysis);
        setMessages([]);
        setStatus('ready');
      } catch (error) {
        if (cancelled) {
          return;
        }
        const message = error instanceof Error ? error.message : 'Unknown error';
        setStatus('error');
        setStatusMessage(`AI analysis failed. ${message}`);
      }
    }

    void loadAnalysis();
    return () => {
      cancelled = true;
    };
  }, [features, locale]);

  async function handleSend(): Promise<void> {
    const trimmed = chatInput.trim();
    if (!trimmed || isSending || status !== 'ready') {
      return;
    }

    const nextConversation = [...messages, { role: 'user' as const, content: trimmed }]
      .slice(-LLM_CHAT_MAX_ITEMS);

    setMessages(nextConversation);
    setChatInput('');
    setIsSending(true);

    try {
      const response = await fetch(`${API_BASE_URL}/llm-chat`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          features,
          conversation: nextConversation,
          locale
        })
      });

      const payload = await response.json() as { response?: string; content?: string; error?: string };
      if (!response.ok) {
        throw new Error(payload.error || 'Chat request failed.');
      }

      const assistantMessage = payload.response || payload.content || 'No response received.';
      setMessages(current => (
        [...current, { role: 'assistant' as const, content: assistantMessage }]
          .slice(-LLM_CHAT_MAX_ITEMS)
      ));
    } catch (error) {
      const message = error instanceof Error ? error.message : 'Unknown error';
      setMessages(current => (
        [...current, { role: 'assistant' as const, content: `Error: ${message}` }]
          .slice(-LLM_CHAT_MAX_ITEMS)
      ));
    } finally {
      setIsSending(false);
    }
  }

  return (
    <div className="chart-box" data-revision={dataRevision}>
      <h2 className="chart-title">{tr('AI communication analysis')}</h2>

      {status === 'idle' || status === 'loading' ? (
        <div className="llm-analysis-content">
          <p className={`llm-status llm-status-${status === 'loading' ? 'loading' : 'idle'}`}>{tr(statusMessage)}</p>
        </div>
      ) : null}

      {status === 'error' ? (
        <div className="llm-analysis-content">
          <p className="llm-status llm-status-error">{tr(statusMessage)}</p>
        </div>
      ) : null}

      {status === 'ready' ? (
        <div className="llm-analysis-content">
          <h3>{analysis?.headline || tr('AI communication analysis')}</h3>
          <p>{analysis?.analysis || tr('No analysis provided.')}</p>
          <h4>{tr('Recommendations')}</h4>
          <ul>
            {(analysis?.recommendations && analysis.recommendations.length > 0)
              ? analysis.recommendations.map(rec => <li key={rec}>{rec}</li>)
              : <li>{tr('No recommendations generated.')}</li>}
          </ul>

          <div className="llm-chat-section">
            <h4>{tr('Ask follow up questions from the analysis')}</h4>
            <div className="chat-messages">
              {messages.map((message, index) => (
                <div
                  key={`${message.role}-${index}`}
                  className={`chat-message ${message.role === 'user' ? 'chat-message-user' : 'chat-message-assistant'}`}
                >
                  {message.content}
                </div>
              ))}
              {isSending ? (
                <div className="chat-message chat-message-assistant chat-thinking">{tr('Thinking...')}</div>
              ) : null}
            </div>
            <div className="chat-input-container">
              <input
                id="analysis-chat-input"
                name="analysisChatInput"
                type="text"
                className="chat-input"
                value={chatInput}
                onChange={event => setChatInput(event.target.value)}
                onKeyDown={event => {
                  if (event.key === 'Enter' && !event.shiftKey) {
                    event.preventDefault();
                    void handleSend();
                  }
                }}
                placeholder={tr('Ask about your performance...')}
                disabled={isSending}
              />
              <button className="chat-send-btn" type="button" onClick={() => { void handleSend(); }} disabled={isSending}>
                {tr('Send')}
              </button>
            </div>
          </div>
        </div>
      ) : null}
    </div>
  );
}
