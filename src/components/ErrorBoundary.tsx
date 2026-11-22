import { Component, ErrorInfo, ReactNode } from 'react';

interface ErrorBoundaryProps {
  children: ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  message: string;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  public state: ErrorBoundaryState = {
    hasError: false,
    message: '',
  };

  public static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return {
      hasError: true,
      message: error.message || 'An unexpected application error occurred.',
    };
  }

  public componentDidCatch(error: Error, errorInfo: ErrorInfo) {
    console.error('Application ErrorBoundary caught:', error, errorInfo);
  }

  public render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-[100dvh] w-full bg-[#F6F3EE] text-[#222426] flex items-center justify-center p-6">
          <div className="max-w-md w-full border border-[#222426]/15 bg-[#EAE5DC]/60 p-6 space-y-4">
            <p className="text-xs font-mono-tabular uppercase tracking-widest text-[#6A6E72]">
              KEVIN ARCHIVE · Recovery
            </p>
            <h1 className="text-lg font-normal text-[#222426]">
              Something interrupted the archive view
            </h1>
            <p className="text-xs text-[#6A6E72] leading-relaxed break-words">
              {this.state.message}
            </p>
            <button
              type="button"
              onClick={() => window.location.reload()}
              className="px-4 py-2 text-xs bg-[#222426] text-[#F6F3EE] hover:bg-[#3A3D40] transition-colors cursor-pointer"
            >
              Reload Archive
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
