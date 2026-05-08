# WAPI Architecture

```mermaid
graph TB
    subgraph "Client Layer"
        Client["HTTP Client<br/>(API Consumer)"]
    end

    subgraph "API Server (@wapi/server)"
        API["Hono API Server<br/>:3000"]
        Auth["Auth Service<br/>(API Keys)"]
        Billing["Billing Service<br/>(Token Tracking)"]
        RateLimit["Rate Limiter<br/>(Per-site & Per-key)"]
        Extract["Extract Service<br/>(Orchestrator)"]
        Robots["Robots Service<br/>(robots.txt)"]
        Cache["Cache Service<br/>(Multi-layer)"]
        SiteLoader["Site Loader<br/>(Dynamic Import)"]
    end

    subgraph "Data Layer"
        Redis["Redis<br/>(Hot Cache)"]
        Postgres["PostgreSQL<br/>(Persistent Storage)"]
    end

    subgraph "Site Definitions (sites/*)"
        Sites["Site Modules<br/>(en.wikipedia.org, news.ycombinator.com, etc.)"]
        Fixtures["HTML Fixtures<br/>(Test Data)"]
        Tests["Site Tests<br/>(Validation)"]
    end

    subgraph "Core Packages"
        Framework["@wapi/framework<br/>(Site DSL, Test Utils, CLI)"]
        Page["@wapi/page<br/>(DOM Abstraction)"]
        Schemas["@wapi/schemas<br/>(schema.org Types)"]
    end

    Client -->|"API Request"| API
    API --> Auth
    API --> RateLimit
    API --> Extract
    
    Extract --> Cache
    Extract --> Robots
    Extract --> SiteLoader
    Extract --> Billing
    
    Cache --> Redis
    Cache --> Postgres
    Auth --> Postgres
    Billing --> Postgres
    
    SiteLoader --> Sites
    Sites --> Framework
    Sites --> Fixtures
    Sites --> Tests
    
    Framework --> Page
    Framework --> Schemas
    Extract --> Page
    Extract --> Schemas

    classDef service fill:#e1f5fe,stroke:#01579b,stroke-width:2px
    classDef storage fill:#fff3e0,stroke:#e65100,stroke-width:2px
    classDef package fill:#f3e5f5,stroke:#4a148c,stroke-width:2px
    classDef site fill:#e8f5e9,stroke:#1b5e20,stroke-width:2px
    
    class API,Auth,Billing,RateLimit,Extract,Robots,Cache,SiteLoader service
    class Redis,Postgres storage
    class Framework,Page,Schemas package
    class Sites,Fixtures,Tests site
```

## Component Overview

### **API Layer** (`@wapi/server`)
- **Hono Server**: REST API handling HTTP requests
- **Auth Service**: API key generation and validation
- **Rate Limiter**: Per-site and per-API-key rate limiting
- **Extract Service**: Orchestrates extraction workflow
- **Cache Service**: Multi-layer caching (Redis hot + Postgres cold)
- **Robots Service**: robots.txt enforcement
- **Billing Service**: Token usage tracking
- **Site Loader**: Dynamic loading of site definitions

### **Core Packages**
- **@wapi/framework**: Site definition DSL, extraction context, test utilities, CLI tools
- **@wapi/page**: DOM abstraction layer (PageElement, PageDriver, CheerioDriver)
- **@wapi/schemas**: Hand-written schema.org TypeScript types

### **Site Definitions**
- **Site Modules**: TypeScript modules defining URL patterns, extraction logic, and validation
- **HTML Fixtures**: Saved HTML for testing extractors
- **Tests**: Vitest-based tests ensuring extraction accuracy

### **Data Storage**
- **Redis**: Hot cache for frequently accessed data (TTL-based)
- **PostgreSQL**: Persistent storage for users, API keys, cached extractions, and usage logs

## Request Flow

1. **Client** sends HTTP request with API key
2. **Auth Service** validates API key
3. **Rate Limiter** checks request limits
4. **Extract Service** orchestrates extraction:
   - Checks **Cache Service** (Redis → Postgres)
   - Validates **robots.txt** via Robots Service
   - Loads site definition via **Site Loader**
   - Fetches HTML if not cached
   - Runs extraction using **@wapi/framework** + **@wapi/page**
   - Returns schema.org-typed JSON
5. **Billing Service** tracks token usage
6. Response sent to client

## Key Features

- **Typed Output**: All responses conform to schema.org types
- **Fallback Extraction**: Unknown sites return JSON-LD, OpenGraph, and meta tags
- **Request Coalescing**: Duplicate in-flight requests are merged
- **Testable**: Site definitions run against fixtures in CI
- **Extensible**: New sites added as TypeScript modules