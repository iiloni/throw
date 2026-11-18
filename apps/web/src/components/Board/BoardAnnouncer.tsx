import { board } from './state';

export const CARD_HELP_ID = 'board-card-help';

/** What screen readers hear about moving cards: how to, and each step as it happens. */
export function BoardAnnouncer() {
  const { announcement } = board.use();
  return (
    <>
      <p id={CARD_HELP_ID} hidden>
        Enter opens it. Space picks it up to move it.
      </p>
      <p aria-live="assertive" className="sr-only">
        {announcement}
      </p>
    </>
  );
}
