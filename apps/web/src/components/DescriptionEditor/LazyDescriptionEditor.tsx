import { type ComponentProps, lazy, memo, Suspense, useContext } from 'react';
import { TaskEditorReadyContext } from '@/components/Board/taskMotionContext';
import { DescriptionPreview } from './DescriptionPreview';

const Editor = memo(
  lazy(() =>
    import('./DescriptionEditor').then((module) => ({ default: module.DescriptionEditor })),
  ),
);

export function LazyDescriptionEditor(props: ComponentProps<typeof Editor>) {
  const ready = useContext(TaskEditorReadyContext);
  const preview = <DescriptionPreview document={props.initialContent} />;
  if (!ready) return preview;
  return (
    <Suspense fallback={preview}>
      <Editor {...props} />
    </Suspense>
  );
}
