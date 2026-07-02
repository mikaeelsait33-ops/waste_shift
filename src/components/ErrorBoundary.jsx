import { Component } from 'react';

class ErrorBoundary extends Component {
  constructor(props) {
    super(props);
    this.state = { hasError: false };
  }

  static getDerivedStateFromError() {
    return { hasError: true };
  }

  componentDidCatch(error, errorInfo) {
    console.error('WasteShift recovered from a UI error.', error, errorInfo);
  }

  handleRetry = () => {
    this.setState({ hasError: false });
  };

  handleReload = () => {
    window.location.reload();
  };

  render() {
    if (!this.state.hasError) {
      return this.props.children;
    }

    return (
      <section className="panel error-boundary-panel" role="alert">
        <div className="panel-body">
          <div className="section-header">
            <div>
              <p className="eyebrow">Recovery</p>
              <h2 className="title">Something went wrong</h2>
              <p className="subtitle">
                WasteShift kept your browser data safe. Try this screen again, or reload if the problem continues.
              </p>
            </div>
          </div>
          <div className="manager-row">
            <button type="button" className="primary-button" onClick={this.handleRetry}>
              Try again
            </button>
            <button type="button" className="ghost-button" onClick={this.handleReload}>
              Reload app
            </button>
          </div>
        </div>
      </section>
    );
  }
}

export default ErrorBoundary;
