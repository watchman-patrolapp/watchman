import React from 'react';

const isDev = import.meta.env?.DEV ?? process.env.NODE_ENV === 'development';

class ErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = {
      hasError: false,
      error: null,
      errorInfo: null,
    };
    this.handleReset = this.handleReset.bind(this);
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    this.setState({ errorInfo });
    console.error('ErrorBoundary caught:', error, errorInfo);

    // Hook for external error reporting (e.g. Sentry) — add when ready:
    // reportError(error, errorInfo);
  }

  handleReset() {
    // Try recovering without a full page reload first
    this.setState({ hasError: false, error: null, errorInfo: null });
  }

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    const { error, errorInfo } = this.state;

    return (
      <div className="min-h-screen flex flex-col items-center justify-center p-6 bg-gray-50 dark:bg-gray-900">
        <div className="bg-white dark:bg-gray-800 rounded-2xl shadow border border-gray-100 dark:border-gray-700 max-w-md w-full p-8 text-center">

          {/* Icon */}
          <div className="w-14 h-14 rounded-full bg-red-100 dark:bg-red-900/30 flex items-center justify-center mx-auto mb-4">
            <svg className="w-7 h-7 text-red-500" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2}
                d="M12 9v2m0 4h.01M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
            </svg>
          </div>

          <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
            Something went wrong
          </h2>
          <p className="text-sm text-gray-500 dark:text-gray-400 mb-6">
            The app ran into an unexpected error. Try recovering or reload the page.
          </p>

          {/* Action buttons */}
          <div className="flex gap-3 justify-center mb-6">
            <button
              onClick={this.handleReset}
              className="px-4 py-2 bg-teal-600 hover:bg-teal-700 text-white text-sm font-medium rounded-xl transition"
            >
              Try to recover
            </button>
            <button
              onClick={() => window.location.reload()}
              className="px-4 py-2 bg-gray-100 dark:bg-gray-700 hover:bg-gray-200 dark:hover:bg-gray-600 text-gray-700 dark:text-gray-200 text-sm font-medium rounded-xl transition"
            >
              Reload page
            </button>
          </div>

          {/* Dev-only error details */}
          {isDev && error && (
            <details className="text-left mt-2">
              <summary className="text-xs text-gray-400 dark:text-gray-500 cursor-pointer hover:text-gray-600 dark:hover:text-gray-300 select-none">
                Show error details (dev only)
              </summary>
              <div className="mt-3 p-3 bg-red-50 dark:bg-red-900/20 rounded-xl border border-red-100 dark:border-red-800 overflow-auto max-h-48">
                <p className="text-xs font-mono text-red-700 dark:text-red-300 whitespace-pre-wrap break-all">
                  {error.toString()}
                </p>
                {errorInfo?.componentStack && (
                  <p className="text-xs font-mono text-red-500 dark:text-red-400 mt-2 whitespace-pre-wrap break-all">
                    {errorInfo.componentStack}
                  </p>
                )}
              </div>
            </details>
          )}
        </div>
      </div>
    );
  }
}

export default ErrorBoundary;