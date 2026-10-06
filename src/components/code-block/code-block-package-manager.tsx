'use client';
/** Pheralb package-manager tabs/select blocks composed from Zero controls. */
import * as React from 'react';
import { Button } from '../ui/button';
import { ZeroIcon } from '../animate-ui/icons/zero-icon';
import { DropdownMenu, DropdownMenuTrigger, DropdownMenuContent,
  DropdownMenuRadioGroup, DropdownMenuRadioItem } from '../dropdown-menu';
import { CodeBlock } from './code-block';
import { CODE_BLOCK_PACKAGE_MANAGERS, useCodeBlockPackageManager } from './code-block-package-preference';
import type { CodeBlockPackageManagerName, CodeBlockPackageManagerProps, CodeBlockPackageManagerOptions } from './code-block.types';
import { codeBlockActionStyle } from './code-block-action-style';

const COMMANDS: Record<CodeBlockPackageManagerName, Record<'install' | 'dlx' | 'run', string>> = {
  bun: { install: 'bun add', dlx: 'bunx --bun', run: 'bun run' },
  npm: { install: 'npm install', dlx: 'npx', run: 'npm run' },
  pnpm: { install: 'pnpm add', dlx: 'pnpm dlx', run: 'pnpm run' },
  yarn: { install: 'yarn add', dlx: 'yarn dlx', run: 'yarn run' },
};

/** Construct commands without evaluating them or blindly rewriting shell source. */
export function getCodeBlockPackageCommand(manager: CodeBlockPackageManagerName,
  command: string, type: 'install' | 'dlx' | 'run' = 'install'): string {
  return `${COMMANDS[manager][type]} ${command}`.trimEnd();
}

export interface CodeBlockPackageManagerSelectorProps extends CodeBlockPackageManagerOptions {
  managers?: readonly CodeBlockPackageManagerName[];
}
/** Radio menu retains keyboard navigation, checked selection and touch support. */
export function CodeBlockPackageManagerSelector({ value, onValueChange, defaultValue, persist,
  managers = CODE_BLOCK_PACKAGE_MANAGERS }: CodeBlockPackageManagerSelectorProps) {
  const preference = useCodeBlockPackageManager({ value, onValueChange, defaultValue, persist });
  return <DropdownMenu><DropdownMenuTrigger asChild>
    <Button animateIcon={false} type="button" variant="ghost" size="sm" className="zero-code-block-action zero-code-package-selector"
      style={codeBlockActionStyle()}
      aria-label={`Package manager: ${preference.value}`}><span>{preference.value}</span><ZeroIcon name="chevron-down" /></Button>
  </DropdownMenuTrigger><DropdownMenuContent align="end" className="zero-code-package-menu">
    <DropdownMenuRadioGroup value={preference.value} onValueChange={next => {
      if (managers.includes(next as CodeBlockPackageManagerName)) preference.setValue(next as CodeBlockPackageManagerName);
    }}>{managers.map(manager => <DropdownMenuRadioItem key={manager} value={manager}>{manager}</DropdownMenuRadioItem>)}</DropdownMenuRadioGroup>
  </DropdownMenuContent></DropdownMenu>;
}

/** Switch package-manager tabs or a compact selector; persistence is explicitly opt-in. */
export function CodeBlockPackageManager({ command, type = 'install', mode = 'tabs', managers = CODE_BLOCK_PACKAGE_MANAGERS,
  value, defaultValue = 'bun', onValueChange, persist, actions, filename = 'Install', ...props }: CodeBlockPackageManagerProps) {
  const preference = useCodeBlockPackageManager({ value, defaultValue, onValueChange, persist });
  const available = [...new Set(managers)].filter(manager => CODE_BLOCK_PACKAGE_MANAGERS.includes(manager));
  const allowed = available.length ? available : [...CODE_BLOCK_PACKAGE_MANAGERS];
  const selected = allowed.includes(preference.value) ? preference.value : allowed[0]!;
  const files = React.useMemo(() => allowed.map(manager => ({ id: manager, label: manager,
    language: 'bash', filename: manager, code: getCodeBlockPackageCommand(manager, command, type),
  })), [allowed.join(','), command, type]);
  return mode === 'tabs' ? <CodeBlock {...props} files={files} activeFileId={selected} actions={actions}
    onFileChange={file => preference.setValue(file.id as CodeBlockPackageManagerName)} />
    : <CodeBlock {...props} code={getCodeBlockPackageCommand(selected, command, type)} language="bash" filename={filename}
      actions={<><CodeBlockPackageManagerSelector value={selected} managers={allowed} onValueChange={preference.setValue} />{actions}</>} />;
}
