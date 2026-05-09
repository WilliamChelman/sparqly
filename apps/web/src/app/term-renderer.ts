import { bestPrefixEntryFor, DEFAULT_PREFIXES } from 'common';
import type { DisplayContext } from './config.service';
import type { Term } from './sparql-result-decoder';

export interface PrefixedIri {
  kind: 'prefixed-iri';
  prefix: string;
  local: string;
  iri: string;
}

export interface BaseIri {
  kind: 'base-iri';
  local: string;
  iri: string;
}

export interface AbsoluteIri {
  kind: 'absolute-iri';
  iri: string;
}

export type IriDisplay = PrefixedIri | BaseIri | AbsoluteIri;

export interface PlainLiteral {
  kind: 'plain-literal';
  lexical: string;
}

export interface LanguageLiteral {
  kind: 'language-literal';
  lexical: string;
  language: string;
}

export interface TypedLiteral {
  kind: 'typed-literal';
  lexical: string;
  datatype: string;
  datatypeDisplay: IriDisplay;
}

export interface NumberLiteral {
  kind: 'number';
  lexical: string;
  datatype: string;
}

export interface BlankDisplay {
  kind: 'blank';
  label: string;
}

export type TermDisplay =
  | IriDisplay
  | PlainLiteral
  | LanguageLiteral
  | TypedLiteral
  | NumberLiteral
  | BlankDisplay;

const XSD = 'http://www.w3.org/2001/XMLSchema#';
const NUMERIC_DATATYPES = new Set<string>([
  `${XSD}integer`,
  `${XSD}decimal`,
  `${XSD}double`,
  `${XSD}float`,
  `${XSD}long`,
  `${XSD}int`,
  `${XSD}short`,
  `${XSD}byte`,
  `${XSD}nonNegativeInteger`,
  `${XSD}nonPositiveInteger`,
  `${XSD}positiveInteger`,
  `${XSD}negativeInteger`,
  `${XSD}unsignedInt`,
  `${XSD}unsignedLong`,
  `${XSD}unsignedShort`,
  `${XSD}unsignedByte`,
]);

const XSD_STRING = `${XSD}string`;
const RDF_LANG_STRING =
  'http://www.w3.org/1999/02/22-rdf-syntax-ns#langString';

export function renderTerm(term: Term, context: DisplayContext): TermDisplay {
  if (term.termType === 'NamedNode') return renderIri(term.value, context);
  if (term.termType === 'BlankNode') {
    return { kind: 'blank', label: `_:${term.value}` };
  }
  return renderLiteral(term, context);
}

export function renderIri(
  iri: string,
  context: DisplayContext,
): IriDisplay {
  const effective = effectivePrefixes(context);
  const entries = Object.entries(effective);
  const match = bestPrefixEntryFor(iri, entries);
  if (match !== undefined) {
    const [prefix, ns] = match;
    return {
      kind: 'prefixed-iri',
      prefix,
      local: iri.slice(ns.length),
      iri,
    };
  }
  if (context.base !== undefined && iri.startsWith(context.base)) {
    return {
      kind: 'base-iri',
      local: iri.slice(context.base.length),
      iri,
    };
  }
  return { kind: 'absolute-iri', iri };
}

function renderLiteral(
  term: { termType: 'Literal'; value: string; language?: string; datatype?: { value: string } },
  context: DisplayContext,
): TermDisplay {
  if (term.language) {
    return {
      kind: 'language-literal',
      lexical: term.value,
      language: term.language,
    };
  }
  const dt = term.datatype?.value;
  if (dt === undefined || dt === XSD_STRING || dt === RDF_LANG_STRING) {
    return { kind: 'plain-literal', lexical: term.value };
  }
  if (NUMERIC_DATATYPES.has(dt)) {
    return { kind: 'number', lexical: term.value, datatype: dt };
  }
  return {
    kind: 'typed-literal',
    lexical: term.value,
    datatype: dt,
    datatypeDisplay: renderIri(dt, context),
  };
}

export function effectivePrefixes(
  context: DisplayContext,
): Record<string, string> {
  return { ...DEFAULT_PREFIXES, ...context.prefixes };
}
