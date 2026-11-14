/** Small real-color comparison, sharing appointment tokens with all three views. */
import { CheckIcon, ClockIcon } from './prototype-icons';
import '../styles/appointment-tone-preview.css';
export function AppointmentTonePreview({ onShowFuture }: { onShowFuture(): void }) {
  return <div className="appointment-tone-preview" role="group" aria-label="Two-tone appointment examples">
    <span className="appointment-tone-sample"><CheckIcon size="var(--calendar-size-12)" /><span>Normal pastel<small>Confirmed · ready</small></span></span>
    <span className="appointment-tone-sample has-attention"><ClockIcon size="var(--calendar-size-12)" /><span>Stronger same hue<small>Missing details · needs attention</small></span></span>
    <button type="button" onClick={onShowFuture}>See future examples →</button>
  </div>;
}
