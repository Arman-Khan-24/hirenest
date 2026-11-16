import React from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import '../src/index.css';
import { ToastProvider } from '../src/components/ui/Toast';
import { AiInterviewPanel } from '../src/components/domain/AiInterviewPanel';
import { ScreeningScorecard } from '../src/components/domain/ScreeningScorecard';
import { aiInterviewApi } from '../src/api/aiInterviews';
const SUB = '11111111-1111-4111-8111-111111111111';
const qc = new QueryClient();
const ClientView = () => {
  const { data = [] } = useQuery({ queryKey: ['c'], queryFn: () => aiInterviewApi.scorecards(SUB) });
  return <div style={{ maxWidth: 820, margin: '24px auto', padding: 16 }}>{data.map((c) => <ScreeningScorecard key={c.sessionId} card={c} />)}</div>;
};
const view = new URLSearchParams(location.search).get('view');
createRoot(document.getElementById('root')!).render(
  <QueryClientProvider client={qc}><ToastProvider>
    {view === 'client' ? <ClientView /> : <div style={{ maxWidth: 820, margin: '24px auto', padding: 16 }}><AiInterviewPanel submissionId={SUB} candidateName="Priya Sharma" /></div>}
  </ToastProvider></QueryClientProvider>
);
