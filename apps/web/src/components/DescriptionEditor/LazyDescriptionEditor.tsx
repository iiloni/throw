import { type ComponentProps, lazy, memo, Suspense } from 'react';

const Editor = memo(
  lazy(() =>
    import('./DescriptionEditor').then((module) => ({ default: module.DescriptionEditor })),
  ),
);

export function LazyDescriptionEditor(props: ComponentProps<typeof Editor>) {
  return (
    <Suspense fallback={<p className="py-4 text-muted-foreground text-sm">Loading description…</p>}>
      <Editor {...props} />
    </Suspense>
  );
}
