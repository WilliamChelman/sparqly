import { parseErrorBody } from './parse-error-body';

describe('parseErrorBody', () => {
  it('lifts the `message` field out of a JSON-string body', () => {
    expect(parseErrorBody(JSON.stringify({ message: 'boom' }))).toBe('boom');
  });

  it('returns a non-JSON string body verbatim', () => {
    expect(parseErrorBody('plain text failure')).toBe('plain text failure');
  });

  it('returns undefined for an empty string body', () => {
    expect(parseErrorBody('')).toBeUndefined();
  });

  it('returns the original JSON string when no `message` field is present', () => {
    const body = JSON.stringify({ status: 'error', code: 42 });
    expect(parseErrorBody(body)).toBe(body);
  });

  it('lifts the `message` field out of an already-parsed object body', () => {
    expect(parseErrorBody({ message: 'malformed query' })).toBe(
      'malformed query',
    );
  });

  it('returns undefined when the object has no string `message`', () => {
    expect(parseErrorBody({ status: 'error' })).toBeUndefined();
    expect(parseErrorBody({ message: 42 })).toBeUndefined();
  });

  it('returns undefined for null or undefined input', () => {
    expect(parseErrorBody(null)).toBeUndefined();
    expect(parseErrorBody(undefined)).toBeUndefined();
  });
});
