import { expect, type Page, test } from '@playwright/test';
import { card, workspaceFixture } from './board-helpers';
import { switcherItem } from './helpers';

type Transition = { types: string[]; names: string[]; animations: string[]; dockBlur: string };

/**
 * Records every view transition the app starts: its types, the names the rail and dock take
 * while it runs, the animations on its pseudo-elements once they start, and the blur the
 * dock's group lays over the pages under it.
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
      const entry: Transition = { types, names: [], animations: [], dockBlur: 'none' };
      log.push(entry);
      transition.ready.then(
        () => {
          entry.names = [...document.querySelectorAll('[data-rail], [data-drawer]')]
            .map((element) => getComputedStyle(element).viewTransitionName)
            .filter((name) => name !== 'none');
          entry.dockBlur = getComputedStyle(
            document.documentElement,
            '::view-transition-group(dock)',
          ).backdropFilter;
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
  // On a phone the dock stays live between pages that both show it, blurring them as they move.
  const docked = (type: string) => (isMobile ? [type, 'docked'] : [type]);

  // A project switch cross-fades the board.
  let count = (await transitions(page)).length;
  if (isMobile) {
    await openMenu(page, true);
    await (await switcherItem(page, 'Kitchen')).click();
  } else
    await page
      .getByRole('navigation', { name: 'Projects', exact: true })
      .getByRole('link', { name: 'Kitchen', exact: true })
      .click();
  const fade = await nextTransition(page, count);
  expect(fade.types).toEqual(docked('fade'));
  expect(fade.names).toContain(live);
  if (isMobile) expect(fade.dockBlur).toContain('blur(32px)');
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
    await (await switcherItem(page, 'Project settings')).click();
  } else {
    await page.getByRole('button', { name: 'Project menu for Kitchen', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Project settings', exact: true }).click();
  }
  const forward = await nextTransition(page, count);
  expect(forward.types).toEqual(docked('forward'));
  if (isMobile) expect(forward.dockBlur).toContain('blur(32px)');
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
    expect(page2.types).toEqual(['forward', 'docked']);
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
    expect(page3.types).toEqual(['forward', 'docked']);
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
  expect(back.types).toEqual(docked('back'));
  await expect(card(page, 'Bake bread')).toBeVisible();

  // The workspace trash has no place in the order, so it rises softly into view.
  count = (await transitions(page)).length;
  if (isMobile) {
    await openMenu(page, true);
    await (await switcherItem(page, 'Workspace trash')).click();
  } else {
    await page.getByRole('button', { name: 'Switch workspace', exact: true }).click();
    await page.getByRole('menuitem', { name: 'Workspace trash', exact: true }).click();
  }
  const enter = await nextTransition(page, count);
  // The trash has no dock, so the board's fades with the page rather than leaving its blur behind.
  expect(enter.types).toEqual(['enter']);
  expect(enter.dockBlur).toBe('none');
  expect(enter.animations).toContain('::view-transition-new(root) page-rise');
  await expect(page).toHaveURL(new RegExp(`/w/${workspaceId}/trash$`));
});

test('a board switch dissolves the page and settles the board in on every visit', async ({
  page,
  isMobile,
  browserName,
}) => {
  test.skip(
    browserName === 'firefox' &&
      !(await page.evaluate(() => CSS.supports('selector(:active-view-transition-type(a))'))),
    'This Firefox has no view transition types, so it runs no page transitions',
  );
  // As each switch's new board is in place: how its first card shows, and how the two page
  // images combine.
  await page.addInitScript(() => {
    const log: { blend: string; card: number }[] = [];
    Object.assign(window, { boardSwitches: log });
    const start = document.startViewTransition?.bind(document);
    if (!start) return;
    document.startViewTransition = ((
      update?: ViewTransitionUpdateCallback | StartViewTransitionOptions,
    ) => {
      const transition = start(update);
      transition.ready.then(
        () => {
          let card = 1;
          const first = document.querySelector('[data-card-id]');
          for (let element = first; element; element = element.parentElement)
            card *= Number(getComputedStyle(element).opacity);
          const blend = getComputedStyle(
            document.documentElement,
            '::view-transition-new(root)',
          ).mixBlendMode;
          log.push({ blend, card: first ? card : -1 });
        },
        () => {},
      );
      return transition;
    }) as typeof document.startViewTransition;
  });
  await workspaceFixture(page);
  await expect(card(page, 'Water tomatoes')).toBeVisible();
  const switches = () =>
    page.evaluate(
      () =>
        (window as unknown as { boardSwitches: { blend: string; card: number }[] }).boardSwitches,
    );
  async function open(name: string) {
    const count = (await switches()).length;
    if (isMobile) {
      await openMenu(page, true);
      await (await switcherItem(page, name)).click();
    } else
      await page
        .getByRole('navigation', { name: 'Projects', exact: true })
        .getByRole('link', { name, exact: true })
        .click();
    await expect.poll(async () => (await switches()).length).toBeGreaterThan(count);
    return (await switches())[count]!;
  }

  const first = await open('Kitchen');
  // The two boards add up, so what they share holds steady through the dissolve.
  expect(first.blend).toBe('plus-lighter');
  expect(first.card).toBeLessThan(0.5);
  await expect(card(page, 'Bake bread')).toBeVisible();
  await open('Garden');
  await expect(card(page, 'Prune roses')).toBeVisible();
  // Kitchen has been seen, and its cards still settle in rather than snapping into place.
  const again = await open('Kitchen');
  expect(again.card).toBeLessThan(0.5);
  await expect(card(page, 'Bake bread')).toHaveCSS('opacity', '1');
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
  if (isMobile) await (await switcherItem(page, 'Workspace trash')).click();
  else await page.getByRole('menuitem', { name: 'Workspace trash', exact: true }).click();
  const fade = await nextTransition(page, count);
  expect(fade.types).toEqual(['enter']);
  expect(fade.animations).toContain('::view-transition-new(root) page-fade-in');
  expect(fade.animations.some((name) => /page-(rise|from|to)/.test(name))).toBe(false);
});
