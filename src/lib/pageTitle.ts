import { useEffect } from 'react'

/**
 * The browser tab's title.
 *
 * `index.html` ships one static title for the whole SPA, which is correct until a
 * page wants its own — nothing in a client-rendered app updates the tab on
 * navigation for free.
 *
 * The base is the APP's name, not a property's. HAZREVIEWS is the only
 * registered property today, so interpolating it would happen to read correctly
 * — which is precisely why the sibling dashboard's trick still must not be
 * copied. 'Trybet Dashboard' is true of that app because its brand IS the app;
 * here the registry is a list, and a tab naming the active property would start
 * lying the moment a second one is added rather than at the moment it is
 * written.
 */
export const BASE_TITLE = 'Haz Reviews'

const SEPARATOR = ' · '

/**
 * Pure so the format is testable in the node environment, where `document` does
 * not exist.
 *
 * A blank label collapses to the base rather than emitting '· Haz Reviews'. That
 * is not hypothetical tidiness — it is what a page renders the moment its label
 * comes from data that has not loaded.
 */
export function pageTitle(label: string): string {
  const trimmed = label.trim()
  return trimmed ? `${trimmed}${SEPARATOR}${BASE_TITLE}` : BASE_TITLE
}

/**
 * Titles the tab for as long as the calling page is mounted.
 *
 * Restores whatever title it found rather than writing a copy of the one in
 * `index.html`. A duplicated constant would drift the moment that file is
 * edited, and the drift shows up only as a wrong tab on the way back out.
 *
 * This is safe while ONE page uses it. Two pages whose mount and unmount
 * interleave can restore a title the other already replaced, so the second
 * adopter is the signal to stop reaching for this hook and derive the title for
 * every route from the nav registry instead.
 */
export function useDocumentTitle(label: string): void {
  useEffect(() => {
    const previous = document.title
    document.title = pageTitle(label)
    return () => {
      document.title = previous
    }
  }, [label])
}
