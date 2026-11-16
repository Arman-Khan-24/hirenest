import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import '../src/index.css';
import { ToastProvider } from '../src/components/ui/Toast';
import { AiInterviewPanel } from '../src/components/domain/AiInterviewPanel';
import { ScreeningScorecard } from '../src/components/domain/ScreeningScorecard';
import { aiInterviewApi } from '../src/api/aiInterviews';
import { AiScoreCell, useAiInterviewSummaries } from '../src/components/domain/AiScore';
const SUB = '11111111-1111-4111-8111-111111111111';
const qc = new QueryClient();
const ClientView = () => {
  const { data = [] } = useQuery({ queryKey: ['c'], queryFn: () => aiInterviewApi.scorecards(SUB) });
  return <div style={{ maxWidth: 820, margin: '24px auto', padding: 16 }}>{data.map((c) => <ScreeningScorecard key={c.sessionId} card={c} />)}</div>;
};
const Cells = () => {
  const { data } = useAiInterviewSummaries([SUB]);
  return <div style={{ maxWidth: 820, margin: '24px auto', padding: 16 }}><table><thead><tr><th>Candidate</th><th>AI interview</th></tr></thead><tbody><tr><td>Priya Sharma</td><td><AiScoreCell submissionId={SUB} summary={data?.[SUB]} viewer="staff" candidateName="Priya Sharma" roleTitle="Senior Data Engineer" /></td></tr></tbody></table></div>;
};
const view = new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}><ToastProvider>
    {view === 'cells' ? <Cells /> : view === 'client' ? <ClientView /> : <div style={{ maxWidth: 820, margin: '24px auto', padding: 16 }}><AiInterviewPanel submissionId={SUB} candidateName="Priya Sharma" /></div>}
  </ToastProvider></QueryClientProvider>
);
