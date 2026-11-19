import React, { Component, type ReactNode } from 'react';
import { AlertTriangle, RefreshCw, Home } from 'lucide-react';
import { Button } from '../ui/kit';

interface Props {
  children: ReactNode;
  fallback?: ReactNode;
  scope?: string;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  public state: State = {
    hasError: false,
    error: null,
  };

  public static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  public componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error('HireNest ErrorBoundary caught an unhandled error:', error, errorInfo);
  }

  private handleReload = () => {
    window.location.reload();
  };

  private handleGoHome = () => {
    window.location.href = '/';
  };

  private handleReset = () => {
    this.setState({ hasError: false, error: null });
  };

  public render() {
    if (this.state.hasError) {
      if (this.props.fallback) {
        return this.props.fallback;
      }

      return (
        <div className="min-h-[320px] w-full flex items-center justify-center p-6 bg-[var(--app-bg)] text-[var(--text-primary)]">
          <div className="max-w-md w-full rounded-[14px] border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8 shadow-sm space-y-5 text-center">
            <div className="mx-auto h-12 w-12 rounded-full bg-amber-50 dark:bg-amber-950/40 text-amber-600 dark:text-amber-400 flex items-center justify-center border border-amber-200 dark:border-amber-800/40">
              <AlertTriangle className="h-6 w-6 stroke-[2]" />
            </div>

            <div className="space-y-1.5">
              <h2 className="text-[17px] font-semibold text-[var(--text-primary)] tracking-[-0.01em]">
                {this.props.scope ? `Could not load ${this.props.scope}` : 'Something went wrong loading this view'}
              </h2>
              <p className="text-[13px] leading-[20px] text-[var(--text-secondary)]">
                An unexpected display issue occurred. Your data is safe and preserved. Try reloading or return to your workspace home.
              </p>
            </div>

            {this.state.error && (
              <div className="text-left bg-[var(--bg-subtle)] border border-[var(--border)] rounded-[8px] p-3 text-[11px] font-mono text-[var(--text-tertiary)] overflow-x-auto max-h-24">
                {this.state.error.message || String(this.state.error)}
              </div>
            )}

            <div className="flex flex-wrap items-center justify-center gap-2 pt-2">
              <Button size="sm" onClick={this.handleReload} className="gap-1.5">
                <RefreshCw className="h-3.5 w-3.5" />
                <span>Reload page</span>
              </Button>
              <Button size="sm" variant="outline" onClick={this.handleReset} className="gap-1.5">
                <span>Try again</span>
              </Button>
              <Button size="sm" variant="ghost" onClick={this.handleGoHome} className="gap-1.5 text-[var(--text-secondary)]">
                <Home className="h-3.5 w-3.5" />
                <span>Home</span>
              </Button>
            </div>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
