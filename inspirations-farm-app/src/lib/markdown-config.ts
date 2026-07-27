/**
 * Markdown rendering configuration
 * - Code highlighting with highlight.js
 * - Math rendering with KaTeX
 * - GitHub Flavored Markdown
 */

import rehypeHighlight from 'rehype-highlight';
import rehypeKatex from 'rehype-katex';
import rehypeSanitize from 'rehype-sanitize';
import remarkGfm from 'remark-gfm';
import remarkMath from 'remark-math';

// Import common languages to reduce bundle size
import javascript from 'highlight.js/lib/languages/javascript';
import typescript from 'highlight.js/lib/languages/typescript';
import python from 'highlight.js/lib/languages/python';
import rust from 'highlight.js/lib/languages/rust';
import go from 'highlight.js/lib/languages/go';
import java from 'highlight.js/lib/languages/java';
import bash from 'highlight.js/lib/languages/bash';
import json from 'highlight.js/lib/languages/json';
import yaml from 'highlight.js/lib/languages/yaml';
import markdown from 'highlight.js/lib/languages/markdown';
import sql from 'highlight.js/lib/languages/sql';
import cpp from 'highlight.js/lib/languages/cpp';
import css from 'highlight.js/lib/languages/css';
import xml from 'highlight.js/lib/languages/xml';
import type { PluggableList } from 'unified';

export const remarkPlugins: PluggableList = [remarkGfm, remarkMath];

export const rehypePlugins: PluggableList = [
  rehypeSanitize,
  [
    rehypeHighlight,
    {
      languages: {
        javascript,
        typescript,
        python,
        rust,
        go,
        java,
        bash,
        json,
        yaml,
        markdown,
        sql,
        cpp,
        css,
        xml,
        html: xml, // Alias
        js: javascript, // Alias
        ts: typescript, // Alias
      },
      ignoreMissing: true, // Don't error on unknown languages
    },
  ],
  [rehypeKatex, { strict: false, throwOnError: false, output: 'html' }],
];
