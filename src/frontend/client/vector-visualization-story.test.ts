import { describe, expect, test } from 'bun:test';
import { createVectorVisualizationStory } from './vector-visualization-story';
import { VectorVisualizationController } from './vector-visualization-controller';
import type { VectorVisualizationSnapshot } from '../../vector/visualization-types';

function snapshot(revision = 1): VectorVisualizationSnapshot {
  return { id: 'public-story', index: 'docs', kind: 'search', status: revision === 1 ? 'running' : 'completed', revision,
    createdAt: '2026-10-08T12:00:00.000Z', updatedAt: '2026-10-08T12:00:00.000Z', stages: [] };
}
const frames = () => [{ atMs: 0, snapshot: snapshot() }, { atMs: 20, snapshot: snapshot(2) }];
describe('explicit vector visualization story', () => {
  test('does not execute commands or autoplay and clones public fixtures', async () => {
    const input = frames(); const story = createVectorVisualizationStory(input);
    expect(story.search).toBeUndefined(); expect(story.ingest).toBeUndefined(); expect(story.cancel).toBeUndefined();
    input[0]!.snapshot.status = 'failed';
    expect((await story.get('public-story'))?.status).toBe('running'); expect(await story.get('other')).toBeNull();
    const revisions: number[] = []; const detach = story.subscribe('public-story', value => { if (value) revisions.push(value.revision); });
    await new Promise(resolve => setTimeout(resolve, 30)); expect(revisions).toEqual([1]);
    detach(); story.dispose(); expect(await story.get('public-story')).toBeNull();
  });
  test('seek/replay revisions stay monotonic for the same live controller', async () => {
    const story = createVectorVisualizationStory(frames()); const controller = new VectorVisualizationController(story);
    controller.attach('public-story'); story.seek(20);
    const complete = controller.getSnapshot().snapshot!; expect(complete.status).toBe('completed');
    story.seek(0); const replay = controller.getSnapshot().snapshot!;
    expect(replay.status).toBe('running'); expect(replay.revision).toBeGreaterThan(complete.revision);
    controller.dispose(); story.dispose();
  });
  test('play completes on presentation time and disposal stops publications', async () => {
    const story = createVectorVisualizationStory(frames(), { speed: 2 }); const values: string[] = [];
    story.subscribe('public-story', value => { if (value) values.push(value.status); }); story.play();
    await new Promise(resolve => setTimeout(resolve, 50)); expect(values.at(-1)).toBe('completed');
    story.dispose(); const count = values.length; story.seek(0); story.play();
    await new Promise(resolve => setTimeout(resolve, 20)); expect(values).toHaveLength(count);
  });
  test('rejects invalid timelines, different operations and private accessor side effects', () => {
    expect(() => createVectorVisualizationStory([])).toThrow();
    expect(() => createVectorVisualizationStory(frames(), { speed: 0 })).toThrow();
    expect(() => createVectorVisualizationStory([{ atMs: 0, snapshot: snapshot() }, { atMs: 0, snapshot: snapshot(2) }])).toThrow();
    expect(() => createVectorVisualizationStory([{ atMs: 0, snapshot: snapshot() }, { atMs: 1, snapshot: { ...snapshot(), index: 'other' } }])).toThrow();
    let reads = 0;
    expect(() => createVectorVisualizationStory([{ atMs: 0, snapshot: { ...snapshot(), get query() { reads++; return undefined; } } }])).toThrow();
    expect(() => createVectorVisualizationStory([{ atMs: 0, snapshot: { ...snapshot(), get id() { reads++; return 'private'; } } }])).toThrow();
    expect(reads).toBe(0);
  });
});
