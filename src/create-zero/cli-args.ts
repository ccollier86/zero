/** Strict argument parsing for the create-zero command. */

export interface CreateZeroCliArgs {
  force: boolean;
  help: boolean;
  install: boolean;
  local: boolean;
  packageName?: string;
  targetDir: string;
  templateDir?: string;
  zeroDependency?: string;
}

const VALUE_FLAGS: ReadonlyMap<string, 'packageName' | 'templateDir' | 'zeroDependency'> = new Map([
  ['--name', 'packageName'],
  ['--template', 'templateDir'],
  ['--zero', 'zeroDependency'],
] as const);

const BOOLEAN_FLAGS: ReadonlyMap<string, 'force' | 'help' | 'install' | 'local'> = new Map([
  ['--force', 'force'],
  ['--help', 'help'],
  ['-h', 'help'],
  ['--install', 'install'],
  ['--local', 'local'],
] as const);

/** Parse one target plus create-zero's documented options, rejecting ambiguity. */
export function parseCreateZeroArgs(args: readonly string[]): CreateZeroCliArgs {
  const values: Partial<CreateZeroCliArgs> = {};
  const seen = new Set<keyof CreateZeroCliArgs>();
  const positionals: string[] = [];

  for (let index = 0; index < args.length; index += 1) {
    const argument = args[index]!;
    const valueKey = VALUE_FLAGS.get(argument);
    if (valueKey) {
      rejectDuplicate(seen, valueKey, argument);
      const value = args[index + 1];
      if (!value || value.startsWith('-')) {
        throw new Error(`[create-zero] Missing value for ${argument}`);
      }
      values[valueKey] = value;
      seen.add(valueKey);
      index += 1;
      continue;
    }

    const booleanKey = BOOLEAN_FLAGS.get(argument);
    if (booleanKey) {
      rejectDuplicate(seen, booleanKey, argument);
      values[booleanKey] = true;
      seen.add(booleanKey);
      continue;
    }

    if (argument.startsWith('-')) {
      throw new Error(`[create-zero] Unknown option: ${argument}`);
    }
    positionals.push(argument);
  }

  if (values.local && values.zeroDependency) {
    throw new Error('[create-zero] --local cannot be combined with --zero');
  }
  if (!values.help && positionals.length !== 1) {
    throw new Error(`[create-zero] Expected exactly one target directory; received ${positionals.length}`);
  }
  if (values.help && positionals.length > 1) {
    throw new Error('[create-zero] Help accepts at most one target directory');
  }

  return {
    force: values.force === true,
    help: values.help === true,
    install: values.install === true,
    local: values.local === true,
    packageName: values.packageName,
    targetDir: positionals[0] ?? '',
    templateDir: values.templateDir,
    zeroDependency: values.zeroDependency,
  };
}

function rejectDuplicate(
  seen: ReadonlySet<keyof CreateZeroCliArgs>,
  key: keyof CreateZeroCliArgs,
  flag: string
): void {
  if (seen.has(key)) throw new Error(`[create-zero] Duplicate option: ${flag}`);
}
