import { err, ok, type Result } from 'neverthrow';

export interface ParsedSourceAddress {
  id: string;
  ref?: string;
}

export interface SourceAddressParseError {
  kind: 'source-address-parse';
  input: string;
  reason: 'missing-at-prefix' | 'empty-id' | 'empty-ref';
  message: string;
}

export function parseSourceAddress(
  input: string,
): Result<ParsedSourceAddress, SourceAddressParseError> {
  if (!input.startsWith('@')) {
    return err({
      kind: 'source-address-parse',
      input,
      reason: 'missing-at-prefix',
      message: `address ${JSON.stringify(input)} must start with \`@\``,
    });
  }
  const body = input.slice(1);
  const lastColon = body.lastIndexOf(':');
  if (lastColon === -1) {
    if (body.length === 0) {
      return err({
        kind: 'source-address-parse',
        input,
        reason: 'empty-id',
        message: `address ${JSON.stringify(input)} has an empty id`,
      });
    }
    return ok({ id: body });
  }
  const id = body.slice(0, lastColon);
  const ref = body.slice(lastColon + 1);
  if (id.length === 0) {
    return err({
      kind: 'source-address-parse',
      input,
      reason: 'empty-id',
      message: `address ${JSON.stringify(input)} has an empty id`,
    });
  }
  if (ref.length === 0) {
    return err({
      kind: 'source-address-parse',
      input,
      reason: 'empty-ref',
      message: `address ${JSON.stringify(input)} has a trailing \`:\` with no ref`,
    });
  }
  return ok({ id, ref });
}
