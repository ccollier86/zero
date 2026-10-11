/** Synthetic native-ref/Slot composition fixture; no fonts, providers or services. */

import * as React from 'react';
import { createRoot } from 'react-dom/client';
import { Heading, Text } from './index';

const paragraph = React.createRef<HTMLParagraphElement>();
const heading = React.createRef<HTMLHeadingElement>();
const parentLabel = React.createRef<HTMLLabelElement>();
const childLabel = React.createRef<HTMLLabelElement>();
const parentHeading = React.createRef<HTMLHeadingElement>();
const childHeading = React.createRef<HTMLHeadingElement>();
const events: string[] = [];
const root = createRoot(document.getElementById('root')!);

root.render(<>
  <Text as="p" ref={paragraph} variant="support" id="body">Canonical body</Text>
  <Heading as="h4" ref={heading} variant="page" id="title">Native outline</Heading>
  <Text as="label" asChild ref={parentLabel} htmlFor="field" variant="label" onClick={() => events.push('parent')}>
    <label ref={childLabel} id="label" onClick={() => events.push('child')}>Field label</label>
  </Text>
  <input id="field" />
  <Heading as="h3" asChild ref={parentHeading} variant="caption">
    <h3 ref={childHeading} id="slotted-title">Slotted outline</h3>
  </Heading>
</>);

Object.assign(window, { typographyTest: {
  snapshot: () => ({
    paragraphTag: paragraph.current?.tagName ?? null,
    headingTag: heading.current?.tagName ?? null,
    parentLabelTag: parentLabel.current?.tagName ?? null,
    childLabelTag: childLabel.current?.tagName ?? null,
    labelRefMatches: parentLabel.current === childLabel.current,
    parentHeadingTag: parentHeading.current?.tagName ?? null,
    childHeadingTag: childHeading.current?.tagName ?? null,
    headingRefMatches: parentHeading.current === childHeading.current,
    events: [...events],
  }),
  unmount: () => root.unmount(),
} });
