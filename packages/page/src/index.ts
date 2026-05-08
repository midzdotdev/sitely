/**
 * `@wapi/page` provides a DOM abstraction layer for reading web pages.
 *
 * The core interfaces {@link PageElement} and {@link PageDriver} define a
 * uniform read-only API that works across different HTML parsing engines.
 * The MVP ships with {@link CheerioDriver} for fast static HTML parsing.
 *
 * @packageDocumentation
 */
export type { PageDriver, PageElement } from "./types.js";
export { CheerioDriver, NULL_ELEMENT } from "./cheerio-driver.js";
export type { CheerioDriverOptions } from "./cheerio-driver.js";
