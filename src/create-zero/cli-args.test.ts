import { describe, expect, test } from 'bun:test';

import { parseCreateZeroArgs } from './cli-args';

describe('parseCreateZeroArgs', () => {
  test('consumes option values and permits one positional target in any order', () => {
    expect(parseCreateZeroArgs([
      '--name', 'acme-app', '--template', '/tmp/starter', 'my-app', '--zero', '^2.0.0', '--force',
    ])).toEqual({
      force: true,
      help: false,
      install: false,
      local: false,
      packageName: 'acme-app',
      targetDir: 'my-app',
      templateDir: '/tmp/starter',
      zeroDependency: '^2.0.0',
    });
  });

  test.each([
    { args: [], message: 'exactly one target' },
    { args: ['one', 'two'], message: 'exactly one target' },
    { args: ['app', '--unknown'], message: 'Unknown option' },
    { args: ['app', '--name'], message: 'Missing value for --name' },
    { args: ['app', '--template', '--force'], message: 'Missing value for --template' },
    { args: ['app', '--zero', '^1', '--zero', '^2'], message: 'Duplicate option' },
    { args: ['app', '--force', '--force'], message: 'Duplicate option' },
    { args: ['app', '--local', '--zero', '^1'], message: '--local cannot be combined' },
  ])('rejects ambiguous invocation $args', ({ args, message }) => {
    expect(() => parseCreateZeroArgs(args)).toThrow(message);
  });

  test('does not mistake an option value for the target', () => {
    expect(() => parseCreateZeroArgs(['--template', '/tmp/starter'])).toThrow(
      'Expected exactly one target directory; received 0'
    );
  });

  test('allows help without a target but still rejects unknown options', () => {
    expect(parseCreateZeroArgs(['--help'])).toMatchObject({ help: true, targetDir: '' });
    expect(() => parseCreateZeroArgs(['--help', '--wat'])).toThrow('Unknown option');
  });
});
