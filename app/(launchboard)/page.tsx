/**
 * page.tsx
 *
 * Root LaunchBoard page. The route group is omitted from the URL, so this file
 * still renders at `/` while inheriting LaunchBoard's route-owned AppShell.
 */

import { LaunchBoardPage } from '../launchboard/launchboard-page';

export const meta = {
  title: 'LaunchBoard',
  description: 'Zero AppShell Kanban playground',
};

export default function HomePage() {
  return <LaunchBoardPage />;
}
