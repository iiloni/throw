import { expect, type Page, test } from '@playwright/test';
import { card, workspaceFixture } from './board-helpers';

type Transition = { types: string[]; names: string[]; animations: string[] };

/**
 * Records every view transition the app starts: its types, the names the rail and dock take
 * while it runs, and the animations on its pseudo-elements once they start.
 */
async function recordTransitions(page: Page) {
  await page.addInitScript(() => {
    const log: Transition[] = [];
    Object.assign(window, { pageTransitions: log });
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((
      update?: ViewTransitionUpdateCallback | StartViewTransitionOptions,
    ) => {
      const transition = start(update);
      const types = update && typeof update === 'object' && update.types ? [...update.types] : [];
      const entry: Transition = { types, names: [], animations: [] };
      log.push(entry);
      transition.ready.then(
        () => {
          entry.names = [...document.querySelectorAll('[data-rail], [data-drawer]')]
            .map((element) => getComputedStyle(element).viewTransitionName)
            .filter((name) => name !== 'none');
          entry.animations = document.documentElement
            .getAnimations({ subtree: true })
            .flatMap((animation) => {
              const effect = animation.effect;
              return effect instanceof KeyframeEffect &&
                effect.pseudoElement?.startsWith('::view-transition') &&
                animation instanceof CSSAnimation
                ? [`${effect.pseudoElement} ${animation.animationName}`]
                : [];
            });
        },
        () => {},
      );
      return transition;
    }) as typeof document.startViewTransition;
  });
}

const transitions = (page: Page) =>
  page.evaluate(() => (window as unknown as { pageTransitions: Transition[] }).pageTransitions);

/** Waits for the next transition after `count` and returns it, once it has started. */
async function nextTransition(page: Page, count: number) {
  await expect.poll(async () => (await transitions(page)).length).toBeGreaterThan(count);
  await expect.poll(async () => (await transitions(page))[count]?.animations.length).toBeTruthy();
  return (await transitions(page))[count]!;
}

async function openMenu(page: Page, isMobile: boolean) {
  await page
    .getByRole('button', {
      name: isMobile ? 'Switch project or workspace' : 'Switch workspace',
      exact: true,
    })
    .click();
}

test('boards cross-fade, ordered pages slide, and the rail and dock stay put', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    browserName === 'firefox' &&
      !(await page.evaluate(() => CSS.supports('selector(:active-view-transition-type(a))'))),
    'This Firefox has no view transition types, so it runs no page transitions',
  );
  await recordTransitions(page);
  const { workspaceId } = await workspaceFixture(page);
  await expect(card(page, 'Water tomatoes')).toBeVisible();
  const live = isMobile ? 'dock' : 'rail';

  // A project switch cross-fades the board.
  let count = (await transitions(page)).length;
  if (isMobile) {
    await openMenu(page, true);
    await page.getByRole('menuitem', { name: 'Kitchen', exact: true }).click();
  } else
    await page
      .getByRole('navigation', { name: 'Projects', exact: true })
      .getByRole('link', { name: 'Kitchen', exact: true })
      .click();
  const fade = await nextTransition(page, count);
  expect(fade.types).toEqual(['fade']);
  expect(fade.names).toContain(live);
  expect(fade.animations).toContain('::view-transition-new(root) page-fade-in');
  expect(fade.animations.some((name) => /\((rail|dock)\)/.test(name))).toBe(false);
  await expect(card(page, 'Bake bread')).toBeVisible();

  // Opening a task changes only the search params, and leaves the motion to the task.
  count = (await transitions(page)).length;
  await card(page, 'Bake bread').click();
  await expect(page).toHaveURL(/task=/);
  await page.keyboard.press('Escape');
  await expect(page).not.toHaveURL(/task=/);
  expect((await transitions(page)).length).toBe(count);

  // Project settings slides forward, a settings page changes beside the list or slides on a
  // phone, and the board slides back.
  if (isMobile) {
    await openMenu(page, true);
    await page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
  } else {
    await page.getByRole('button', { name: 'Project menu for Kitchen', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
  }
  const forward = await nextTransition(page, count);
  expect(forward.types).toEqual(['forward']);
  expect(forward.animations).toContain('::view-transition-new(root) page-from-right');
  await expect(page.getByLabel('Project name', { exact: true })).toBeVisible();

  count = (await transitions(page)).length;
  if (isMobile) {
    await page.getByRole('button', { name: 'Settings page: General' }).click();
    await page
      .getByRole('dialog', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'Tags', exact: true })
      .click();
  } else
    await page
      .getByRole('navigation', { name: 'Settings pages' })
      .getByRole('link', { name: 'Tags', exact: true })
      .click();
  const page2 = await nextTransition(page, count);
  if (isMobile) {
    expect(page2.types).toEqual(['forward']);
    expect(page2.names).toContain('dock');
  } else {
    expect(page2.types).toEqual(['inner']);
    expect(page2.animations).toContain('::view-transition-new(settings-page) page-rise');
    expect(page2.animations.some((name) => name.includes('(root) page-'))).toBe(false);
  }
  await expect(page.getByRole('heading', { name: 'Tags', exact: true })).toBeVisible();

  // Switching from a project page to a User page in the unified hub keeps the same inner/slide motion.
  count = (await transitions(page)).length;
  if (isMobile) {
    await page.getByRole('button', { name: 'Settings page: Tags' }).click();
    await page
      .getByRole('dialog', { name: 'Settings', exact: true })
      .getByRole('link', { name: 'Account', exact: true })
      .click();
  } else
    await page
      .getByRole('navigation', { name: 'Settings pages' })
      .getByRole('link', { name: 'Account', exact: true })
      .click();
  const page3 = await nextTransition(page, count);
  if (isMobile) {
    expect(page3.types).toEqual(['forward']);
    expect(page3.names).toContain('dock');
  } else {
    expect(page3.types).toEqual(['inner']);
    expect(page3.animations).toContain('::view-transition-new(settings-page) page-rise');
  }
  await expect(page.getByRole('heading', { name: 'Account', exact: true })).toBeVisible();

  // Settings pages replace one another in history, so Back leaves them in one step.
  count = (await transitions(page)).length;
  await page.goBack();
  const back = await nextTransition(page, count);
  expect(back.types).toEqual(['back']);
  await expect(card(page, 'Bake bread')).toBeVisible();

  // The workspace trash has no place in the order, so it rises softly into view.
  count = (await transitions(page)).length;
  if (isMobile) await openMenu(page, true);
  else await page.getByRole('button', { name: 'Switch workspace', exact: true }).click();
  await page.getByRole('menuitem', { name: 'Workspace trash', exact: true }).click();
  const enter = await nextTransition(page, count);
  expect(enter.types).toEqual(['enter']);
  expect(enter.animations).toContain('::view-transition-new(root) page-rise');
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/trash$`));
});

test('reduced motion turns page transitions into a short cross-fade', async ({
  page,
  isMobile,
}) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await recordTransitions(page);
  await workspaceFixture(page);
  const count = (await transitions(page)).length;
  await openMenu(page, isMobile);
  await page.getByRole('menuitem', { name: 'Workspace trash', exact: true }).click();
  const fade = await nextTransition(page, count);
  expect(fade.types).toEqual(['enter']);
  expect(fade.animations).toContain('::view-transition-new(root) page-fade-in');
  expect(fade.animations.some((name) => /page-(rise|from|to)/.test(name))).toBe(false);
});
