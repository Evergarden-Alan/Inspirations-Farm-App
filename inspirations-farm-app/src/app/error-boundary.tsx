"use client";

/**
 * Error Boundary component for catching and displaying React errors gracefully.
 * Prevents the entire app from crashing when a component throws an error.
 */

import { Component, ReactNode } from "react";
import { AlertTriangle } from "lucide-react";
import { captureError } from "@/lib/sentry";

interface ErrorBoundaryProps {
  children: ReactNode;
  fallback?: (error: Error, retry: () => void) => ReactNode;
}

interface ErrorBoundaryState {
  hasError: boolean;
  error: Error | null;
}

export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  constructor(props: ErrorBoundaryProps) {
    super(props);
    this.state = { hasError: false, error: null };
  }

  static getDerivedStateFromError(error: Error): ErrorBoundaryState {
    return { hasError: true, error };
  }

  componentDidCatch(error: Error, errorInfo: React.ErrorInfo) {
    console.error("[ErrorBoundary] Caught error:", error, errorInfo);
    // 上报到 Sentry（如果已配置）
    captureError(error, {
      componentStack: errorInfo.componentStack,
      errorBoundary: true,
    });
  }

  retry = () => {
    this.setState({ hasError: false, error: null });
  };

  render() {
    if (this.state.hasError && this.state.error) {
      if (this.props.fallback) {
        return this.props.fallback(this.state.error, this.retry);
      }

      // Default error UI
      return (
        <div className="farm-lock flex min-h-screen items-center justify-center p-4">
          <div className="farm-panel w-full max-w-md p-7 text-center">
            <AlertTriangle className="mx-auto mb-4 h-12 w-12 text-[var(--farm-warning)]" />
            <h2 className="mb-2 text-lg font-semibold text-[var(--farm-ink)]">
              出错了
            </h2>
            <p className="mb-5 text-sm text-[var(--farm-muted)]">
              {this.state.error.message || "未知错误"}
            </p>
            <button
              onClick={this.retry}
              className="farm-primary-button min-h-10 px-5 text-sm font-medium transition-colors"
            >
              重试
            </button>
          </div>
        </div>
      );
    }

    return this.props.children;
  }
}
