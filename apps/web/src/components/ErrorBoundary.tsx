import { Component, type ReactNode } from "react";
import { AlertCircle } from "lucide-react";
import { api } from "../lib/api";

interface Props {
  children: ReactNode;
}

interface State {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<Props, State> {
  constructor(props: Props) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): State {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("Error boundary caught:", error, errorInfo);
    // Log to backend for monitoring (fails silently if API unavailable)
    api.post("/errors", { 
      error: error.message, 
      stack: error.stack,
      componentStack: errorInfo.componentStack 
    }).catch(() => {/* swallow */});
  }

  render() {
    if (this.state.hasError) {
      return (
        <div className="grid h-full place-items-center">
          <div className="flex flex-col items-center gap-4 rounded-lg bg-red-50 p-6 text-center dark:bg-red-950/30">
            <AlertCircle className="h-12 w-12 text-red-600" />
            <div>
              <h1 className="text-lg font-bold text-red-900 dark:text-red-300">Something went wrong</h1>
              <p className="mt-1 text-sm text-red-700 dark:text-red-400">
                {this.state.error?.message || "An unexpected error occurred"}
              </p>
            </div>
            <button
              onClick={() => window.location.reload()}
              className="mt-2 rounded-lg bg-red-600 px-4 py-2 text-sm font-medium text-white hover:bg-red-700"
            >
              Reload page
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
