import React from 'react';
import { FaSync, FaExclamationTriangle } from 'react-icons/fa';

export default class ChatErrorBoundary extends React.Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error) {
    return { hasError: true, error };
  }

  componentDidCatch(error, errorInfo) {
    console.error('Chat Error:', error, errorInfo);
    // Log to your backend if needed
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="min-h-screen flex items-center justify-center bg-gray-50 dark:bg-gray-900 p-4">
          <div className="bg-white dark:bg-gray-800 rounded-2xl p-6 max-w-md text-center shadow-lg border border-red-200 dark:border-red-800">
            <FaExclamationTriangle className="w-12 h-12 text-red-500 mx-auto mb-4" />
            <h2 className="text-xl font-bold text-gray-900 dark:text-white mb-2">
              Chat Temporarily Unavailable
            </h2>
            <p className="text-gray-600 dark:text-gray-400 mb-4 text-sm">
              {this.state.error?.message || 'Something went wrong loading the chat.'}
            </p>
            <div className="flex justify-center space-x-2">
              <button
                onClick={() => this.setState({ hasError: false, error: null })}
                className="inline-flex items-center px-4 py-2 bg-gray-200 dark:bg-gray-700 text-gray-800 dark:text-gray-200 rounded-xl hover:bg-gray-300 dark:hover:bg-gray-600 transition mr-2"
              >
                Try Again
              </button>
              <button
                onClick={() => window.location.reload()}
                className="inline-flex items-center px-4 py-2 bg-indigo-600 text-white rounded-xl hover:bg-indigo-700 transition"
              >
                <FaSync className="mr-2" /> Reload
              </button>
            </div>
          </div>
        </div>
      );
    }
    return this.props.children;
  }
}