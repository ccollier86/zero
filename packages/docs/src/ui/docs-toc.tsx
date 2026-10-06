import { useEffect, useState } from 'react';
import { List } from '@zero/framework/icons';
import type { DocsHeading } from '../content/types';

export function DocsToc({ headings }: { readonly headings: readonly DocsHeading[] }) {
  const sections = headings.filter(heading => heading.depth >= 2 && heading.depth <= 4);
  const [active, setActive] = useState(sections[0]?.id);
  useEffect(() => {
    const nodes = sections.map(heading => document.getElementById(heading.id)).filter((node): node is HTMLElement => !!node);
    if (!nodes.length || !('IntersectionObserver' in window)) return;
    const update = () => {
      const threshold = document.querySelector('.zero-docs-header')?.getBoundingClientRect().height ?? 0;
      // Pick the last heading above the reading line, even when scrolling past a short section.
      const passed = nodes.filter(node => node.getBoundingClientRect().top <= threshold + window.innerHeight * .12);
      const atEnd = window.scrollY + window.innerHeight >= document.documentElement.scrollHeight - 2;
      setActive((atEnd ? nodes.at(-1) : passed.at(-1) ?? nodes[0])!.id);
    };
    const observer = new IntersectionObserver(update, { rootMargin: '-15% 0px -65% 0px' });
    nodes.forEach(node => observer.observe(node));
    window.addEventListener('scroll', update, { passive: true }); update();
    return () => { observer.disconnect(); window.removeEventListener('scroll', update); };
  }, [headings]);
  if (!sections.length) return null;
  return <aside className="zero-docs-toc" aria-label="On this page"><div className="zero-docs-toc-title"><List aria-hidden="true" />On this page</div>
    <nav><ol>{sections.map(heading => <li key={heading.id} data-depth={heading.depth}><a href={`#${encodeURIComponent(heading.id)}`} aria-current={heading.id === active ? 'location' : undefined} onClick={() => setActive(heading.id)}>{heading.text}</a></li>)}</ol></nav>
  </aside>;
}
