declare const _default: {
    site: {
        id: string;
        displayName: string;
        homepage: string;
    };
    origins: {
        hostname: string;
        templated: true;
    }[];
    locales: {
        source: "host";
        values: string[];
        default: string;
    };
    normalizeUrl: (url: string) => string;
    rateLimit: {
        maxConcurrent: number;
        requestsPerSecond: number;
    };
    capabilities: {
        network: {
            egress: "site-only";
        };
        filesystem: "none";
        process: "none";
        timers: {
            maxWallMs: number;
        };
        memory: {
            maxMb: number;
        };
    };
    framework: {
        minVersion: string;
        maxVersion: string;
    };
    schemas: {
        Article: import("zod").ZodObject<{
            image: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodObject<{
                contentUrl: import("zod").ZodOptional<import("zod").ZodString>;
                width: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                height: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                caption: import("zod").ZodOptional<import("zod").ZodString>;
                thumbnailUrl: import("zod").ZodOptional<import("zod").ZodString>;
                "@type": import("zod").ZodOptional<import("zod").ZodString>;
                name: import("zod").ZodOptional<import("zod").ZodString>;
                url: import("zod").ZodOptional<import("zod").ZodString>;
                description: import("zod").ZodOptional<import("zod").ZodString>;
                identifier: import("zod").ZodOptional<import("zod").ZodString>;
                sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
            }, import("zod/v4/core").$loose>]>>;
            headline: import("zod").ZodOptional<import("zod").ZodString>;
            author: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodObject<{
                image: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodObject<{
                    contentUrl: import("zod").ZodOptional<import("zod").ZodString>;
                    width: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                    height: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                    caption: import("zod").ZodOptional<import("zod").ZodString>;
                    thumbnailUrl: import("zod").ZodOptional<import("zod").ZodString>;
                    "@type": import("zod").ZodOptional<import("zod").ZodString>;
                    name: import("zod").ZodOptional<import("zod").ZodString>;
                    url: import("zod").ZodOptional<import("zod").ZodString>;
                    description: import("zod").ZodOptional<import("zod").ZodString>;
                    identifier: import("zod").ZodOptional<import("zod").ZodString>;
                    sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
                }, import("zod/v4/core").$loose>]>>;
                givenName: import("zod").ZodOptional<import("zod").ZodString>;
                familyName: import("zod").ZodOptional<import("zod").ZodString>;
                email: import("zod").ZodOptional<import("zod").ZodString>;
                jobTitle: import("zod").ZodOptional<import("zod").ZodString>;
                birthDate: import("zod").ZodOptional<import("zod").ZodString>;
                nationality: import("zod").ZodOptional<import("zod").ZodString>;
                "@type": import("zod").ZodOptional<import("zod").ZodString>;
                name: import("zod").ZodOptional<import("zod").ZodString>;
                url: import("zod").ZodOptional<import("zod").ZodString>;
                description: import("zod").ZodOptional<import("zod").ZodString>;
                identifier: import("zod").ZodOptional<import("zod").ZodString>;
                sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
            }, import("zod/v4/core").$loose>, import("zod").ZodString, import("zod").ZodArray<import("zod").ZodUnion<readonly [import("zod").ZodObject<{
                image: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodObject<{
                    contentUrl: import("zod").ZodOptional<import("zod").ZodString>;
                    width: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                    height: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                    caption: import("zod").ZodOptional<import("zod").ZodString>;
                    thumbnailUrl: import("zod").ZodOptional<import("zod").ZodString>;
                    "@type": import("zod").ZodOptional<import("zod").ZodString>;
                    name: import("zod").ZodOptional<import("zod").ZodString>;
                    url: import("zod").ZodOptional<import("zod").ZodString>;
                    description: import("zod").ZodOptional<import("zod").ZodString>;
                    identifier: import("zod").ZodOptional<import("zod").ZodString>;
                    sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
                }, import("zod/v4/core").$loose>]>>;
                givenName: import("zod").ZodOptional<import("zod").ZodString>;
                familyName: import("zod").ZodOptional<import("zod").ZodString>;
                email: import("zod").ZodOptional<import("zod").ZodString>;
                jobTitle: import("zod").ZodOptional<import("zod").ZodString>;
                birthDate: import("zod").ZodOptional<import("zod").ZodString>;
                nationality: import("zod").ZodOptional<import("zod").ZodString>;
                "@type": import("zod").ZodOptional<import("zod").ZodString>;
                name: import("zod").ZodOptional<import("zod").ZodString>;
                url: import("zod").ZodOptional<import("zod").ZodString>;
                description: import("zod").ZodOptional<import("zod").ZodString>;
                identifier: import("zod").ZodOptional<import("zod").ZodString>;
                sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
            }, import("zod/v4/core").$loose>, import("zod").ZodString]>>]>>;
            datePublished: import("zod").ZodOptional<import("zod").ZodString>;
            dateModified: import("zod").ZodOptional<import("zod").ZodString>;
            publisher: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodObject<{
                image: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodObject<{
                    contentUrl: import("zod").ZodOptional<import("zod").ZodString>;
                    width: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                    height: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                    caption: import("zod").ZodOptional<import("zod").ZodString>;
                    thumbnailUrl: import("zod").ZodOptional<import("zod").ZodString>;
                    "@type": import("zod").ZodOptional<import("zod").ZodString>;
                    name: import("zod").ZodOptional<import("zod").ZodString>;
                    url: import("zod").ZodOptional<import("zod").ZodString>;
                    description: import("zod").ZodOptional<import("zod").ZodString>;
                    identifier: import("zod").ZodOptional<import("zod").ZodString>;
                    sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
                }, import("zod/v4/core").$loose>]>>;
                logo: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodObject<{
                    contentUrl: import("zod").ZodOptional<import("zod").ZodString>;
                    width: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                    height: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodNumber, import("zod").ZodString]>>;
                    caption: import("zod").ZodOptional<import("zod").ZodString>;
                    thumbnailUrl: import("zod").ZodOptional<import("zod").ZodString>;
                    "@type": import("zod").ZodOptional<import("zod").ZodString>;
                    name: import("zod").ZodOptional<import("zod").ZodString>;
                    url: import("zod").ZodOptional<import("zod").ZodString>;
                    description: import("zod").ZodOptional<import("zod").ZodString>;
                    identifier: import("zod").ZodOptional<import("zod").ZodString>;
                    sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
                }, import("zod/v4/core").$loose>]>>;
                foundingDate: import("zod").ZodOptional<import("zod").ZodString>;
                address: import("zod").ZodOptional<import("zod").ZodString>;
                "@type": import("zod").ZodOptional<import("zod").ZodString>;
                name: import("zod").ZodOptional<import("zod").ZodString>;
                url: import("zod").ZodOptional<import("zod").ZodString>;
                description: import("zod").ZodOptional<import("zod").ZodString>;
                identifier: import("zod").ZodOptional<import("zod").ZodString>;
                sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
            }, import("zod/v4/core").$loose>, import("zod").ZodString]>>;
            articleBody: import("zod").ZodOptional<import("zod").ZodString>;
            wordCount: import("zod").ZodOptional<import("zod").ZodNumber>;
            keywords: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
            inLanguage: import("zod").ZodOptional<import("zod").ZodString>;
            thumbnailUrl: import("zod").ZodOptional<import("zod").ZodString>;
            "@type": import("zod").ZodOptional<import("zod").ZodString>;
            name: import("zod").ZodOptional<import("zod").ZodString>;
            url: import("zod").ZodOptional<import("zod").ZodString>;
            description: import("zod").ZodOptional<import("zod").ZodString>;
            identifier: import("zod").ZodOptional<import("zod").ZodString>;
            sameAs: import("zod").ZodOptional<import("zod").ZodUnion<readonly [import("zod").ZodString, import("zod").ZodArray<import("zod").ZodString>]>>;
        }, import("zod/v4/core").$loose>;
    };
    resources: {
        article: {
            schema: string;
            params: {
                title: {
                    type: "string";
                    required: true;
                    description: string;
                };
            };
            resolve: (params: Record<string, string>) => string;
            ttl: {
                default: string;
                min: string;
                max: string;
            };
        };
    };
    pages: {
        "/wiki/:title": {
            provides: string[];
            examples: string[];
            validate: (ctx: import("@sitely/framework").ExtractContext) => boolean;
            extract: (ctx: import("@sitely/framework").ExtractContext) => Promise<{
                article: {
                    title: string;
                    summary: string;
                    image: import("@sitely/framework").MediaRef | null;
                    categories: string[];
                    lastModified: string | null;
                    url: string;
                    canonical: string | null;
                };
            }>;
        };
    };
    crawl: {
        enabled: true;
        respectRobotsTxt: true;
        maxDepth: number;
        filterLinks: (url: string) => boolean;
    };
};
export default _default;
//# sourceMappingURL=index.d.ts.map