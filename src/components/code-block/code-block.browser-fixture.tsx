/** Disposable CodeBlock gallery: no application, auth, persistence or network service. */
import * as React from 'react';
import type { ShikiTransformer } from 'shiki';
import { createRoot } from 'react-dom/client';
import { Button } from '../ui/button';
import { CodeBlock, CodeBlockHeader, CodeBlockGroup, CodeBlockIcon, CodeBlockTitle, CodeBlockFiles,
  CodeBlockContent, CodeBlockCode, CodeBlockCopyButton, CodeBlockInline, CodeBlockCopyText,
  CodeBlockPackageManager, CodeBlockPre } from './index';

declare global {
  interface Window {
    __codeProbe: { writes: string[]; copies: string[]; failures: number; reject: boolean; hold: boolean;
      release?: () => void; ref?: HTMLButtonElement | null; reset(): void };
  }
}

const probe = window.__codeProbe = {
  writes: [] as string[], copies: [] as string[], failures: 0, reject: false, hold: false,
  reset() { this.writes = []; this.copies = []; this.failures = 0; this.reject = false; this.hold = false; },
} as Window['__codeProbe'];
Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { async writeText(content: string) {
  probe.writes.push(content);
  if (probe.hold) await new Promise<void>(resolve => { probe.release = resolve; });
  if (probe.reject) throw new Error('Synthetic clipboard rejection');
} } });

const SOURCE = 'const previous = 1; // [!code --]\nconst current = 2; // [!code ++]\nconsole.log(current); // [!code focus]\nconst explanation = "hello"; // [!code highlight]';
const LONG = 'const url = "' + 'a-very-long-endpoint/'.repeat(32) + '";';

function TransformerGenerationProbe() {
  const [generation, setGeneration] = React.useState(0);
  const transformers = React.useRef<ShikiTransformer[]>([{ name: 'custom-stamp', pre(node) {
    node.properties['data-custom-stamp'] = 'original';
  } }]);
  return <section>
    <Button data-testid="replace-transformer" onClick={() => {
      transformers.current[0]!.pre = node => { node.properties['data-custom-stamp'] = 'replacement'; };
      setGeneration(value => value + 1);
    }}>Replace same-name transformer</Button>
    <CodeBlock code="stable source" language="text" data-testid="custom-transformer"
      data-generation={generation} transformers={transformers.current} transformerIdentity="custom-stamp:v1" />
  </section>;
}

function Gallery() {
  const [code, setCode] = React.useState('const first = "old source";');
  const [wrap, setWrap] = React.useState(false);
  const [active, setActive] = React.useState('server');
  const [prevent, setPrevent] = React.useState(false);
  const [resetMs, setResetMs] = React.useState(40);
  return <main className="zero-public-page mx-auto max-w-4xl space-y-6 p-6" data-testid="fixture-ready">
    <header><h1 className="text-2xl font-semibold">Code examples</h1><p className="text-public-muted-foreground">Shared, tokenized blocks with complete highlighting and reusable tools.</p></header>
    <CodeBlock code={SOURCE} language="ts" filename="workflow.ts" lineAnchors="annotated" meta='/current/' data-testid="annotations" />
    <CodeBlock files={[{ id: 'server', filename: 'server.ts', language: 'ts', code: 'const server = "first";' },
      { id: 'client', filename: 'client.tsx', language: 'tsx', code: 'const Client = () => <p>Second</p>;' }]}
      activeFileId={active} onFileChange={file => setActive(file.id)} minLines={5} data-testid="files"
      onCopy={file => probe.copies.push(file.id)} />
    <section><Button onClick={() => setWrap(value => !value)} data-testid="wrap-toggle">Toggle wrapping</Button>
      <CodeBlock code={LONG} language="ts" filename="long-line.ts" wordWrap={wrap} data-testid="long" /></section>
    <CodeBlock code={code} language="ts" filename="controlled.ts" data-testid="controlled">
      <CodeBlockHeader><CodeBlockGroup><CodeBlockIcon /><CodeBlockTitle /></CodeBlockGroup>
        <CodeBlockGroup><Button onClick={() => setCode('const second = "new source";')}>Change source</Button>
          <CodeBlockCopyButton ref={node => { probe.ref = node; }} onClick={event => { if (prevent) event.preventDefault(); }}
            onCopy={source => probe.copies.push(source)} onCopyError={() => probe.failures++} /></CodeBlockGroup>
      </CodeBlockHeader><CodeBlockContent><CodeBlockCode /></CodeBlockContent>
    </CodeBlock>
    <Button onClick={() => setPrevent(value => !value)} data-testid="prevent-copy">Toggle copy prevention</Button>
    <CodeBlockInline code="bun add @zero/framework" language="bash" data-testid="inline" />
    <Button onClick={() => setResetMs(0)} data-testid="persist-feedback">Persist copy feedback</Button>
    <CodeBlockCopyText content="morph text" data-testid="morph-copy" resetAfterMs={resetMs} />
    <CodeBlockPackageManager command="@zero/framework" persist="zero-code-browser-test" data-testid="packages-tabs" />
    <CodeBlockPackageManager command="@zero/framework" mode="select" persist="zero-code-browser-test" data-testid="packages-select" />
    <CodeBlockPackageManager command="local-only" data-testid="packages-no-persist" />
    <CodeBlockPre data-language="ts" data-title="Compiled Markdown" data-testid="pre">
      <code><span className="line">one</span>{'\n'}<span className="line">two</span></code>
    </CodeBlockPre>
    <CodeBlock code={'<img src=x onerror="window.__xss=1">'} language="text" data-testid="escaped" />
    <CodeBlock code="unsupported source" language="unknown-language" data-testid="fallback" />
    <TransformerGenerationProbe />
  </main>;
}
createRoot(document.getElementById('root')!).render(<Gallery />);
