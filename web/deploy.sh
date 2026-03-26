#!/bin/bash

# Neighborhood Watch Platform - Vercel Deployment Script
# Usage: ./deploy.sh [environment]
# Environment: dev, preview, prod (default: prod)

set -e

# Configuration
PROJECT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ENVIRONMENT=${1:-prod}
TIMESTAMP=$(date +"%Y%m%d_%H%M%S")

# Colors for output
RED='\033[0;31m'
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
BLUE='\033[0;34m'
NC='\033[0m' # No Color

# Logging function
log() {
    echo -e "${BLUE}[$(date '+%Y-%m-%d %H:%M:%S')]${NC} $1"
}

error() {
    echo -e "${RED}[ERROR]${NC} $1" >&2
}

success() {
    echo -e "${GREEN}[SUCCESS]${NC} $1"
}

warning() {
    echo -e "${YELLOW}[WARNING]${NC} $1"
}

# Check prerequisites
check_prerequisites() {
    log "Checking prerequisites..."
    
    # Check if Vercel CLI is installed
    if ! command -v vercel &> /dev/null; then
        error "Vercel CLI is not installed. Please run: npm install -g vercel"
        exit 1
    fi
    
    # Check if logged into Vercel
    if ! vercel whoami &> /dev/null; then
        error "Not logged into Vercel. Please run: vercel login"
        exit 1
    fi
    
    # Check if package.json exists
    if [ ! -f "$PROJECT_DIR/package.json" ]; then
        error "package.json not found. Make sure you're in the correct directory."
        exit 1
    fi
    
    success "Prerequisites check passed"
}

# Install dependencies
install_dependencies() {
    log "Installing dependencies..."
    cd "$PROJECT_DIR"
    npm install
    success "Dependencies installed"
}

# Build the application
build_application() {
    log "Building application for $ENVIRONMENT environment..."
    
    case $ENVIRONMENT in
        dev)
            npm run build -- --mode development
            ;;
        preview)
            npm run build -- --mode preview
            ;;
        prod)
            npm run build -- --mode production
            ;;
        *)
            error "Invalid environment: $ENVIRONMENT. Use: dev, preview, or prod"
            exit 1
            ;;
    esac
    
    success "Build completed"
}

# Verify build
verify_build() {
    log "Verifying build..."
    
    if [ ! -d "$PROJECT_DIR/dist" ]; then
        error "Build directory not found. Build may have failed."
        exit 1
    fi
    
    # Check for main files
    if [ ! -f "$PROJECT_DIR/dist/index.html" ]; then
        error "index.html not found in build directory"
        exit 1
    fi
    
    success "Build verification passed"
}

# Deploy to Vercel
deploy_to_vercel() {
    log "Deploying to Vercel..."
    cd "$PROJECT_DIR"
    
    case $ENVIRONMENT in
        dev)
            vercel --dev
            ;;
        preview)
            vercel --preivew
            ;;
        prod)
            vercel --prod
            ;;
    esac
    
    success "Deployment completed"
}

# Health check
health_check() {
    log "Performing health check..."
    
    # Get deployment URL
    DEPLOYMENT_URL=$(vercel --url 2>/dev/null | tail -1)
    
    if [ -n "$DEPLOYMENT_URL" ]; then
        log "Checking deployment at: $DEPLOYMENT_URL"
        
        # Basic connectivity check
        if curl -s --head --fail "$DEPLOYMENT_URL" > /dev/null; then
            success "Deployment is accessible"
        else
            warning "Deployment URL not accessible yet. Please check manually."
        fi
    else
        warning "Could not retrieve deployment URL. Please check Vercel dashboard."
    fi
}

# Main deployment function
main() {
    log "Starting deployment process for Neighborhood Watch Platform"
    log "Environment: $ENVIRONMENT"
    log "Timestamp: $TIMESTAMP"
    echo
    
    check_prerequisites
    install_dependencies
    build_application
    verify_build
    
    echo
    log "Build artifacts ready for deployment"
    
    deploy_to_vercel
    health_check
    
    echo
    success "Deployment process completed successfully!"
    log "Next steps:"
    log "1. Verify the deployment in your browser"
    log "2. Test all major functionality"
    log "3. Check the Vercel dashboard for any issues"
}

# Run main function
main "$@"