import { type ComponentProps, lazy, memo, Suspense, useContext } from 'react';
import { TaskEditorReadyContext } from '@/components/Board/taskMotionContext';
import { TaskReferenceScope } from '@/components/TaskReferences/TaskReferences';
import { DescriptionPreview } from './DescriptionPreview';

const Editor = memo(
  lazy(() =>
    import('./DescriptionEditor').then((module) => ({ default: module.DescriptionEditor })),
  ),
);

export function LazyDescriptionEditor({
  referencesFor,
  ...props
}: ComponentProps<typeof Editor> & {
  /** The task this text belongs to: its `#KEY-N` references resolve in that task's workspace. */
  referencesFor?: string;
}) {
  const ready = useContext(TaskEditorReadyContext);
  const preview = <DescriptionPreview document={props.initialContent} />;
  const editor = !ready ? (
    preview
  ) : (
    <Suspense fallback={preview}>
      <Editor {...props} />
    </Suspense>
  );
  return referencesFor ? (
    <TaskReferenceScope taskId={referencesFor}>{editor}</TaskReferenceScope>
  ) : (
    editor
  );
}
