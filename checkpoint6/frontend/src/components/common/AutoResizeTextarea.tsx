import { useEffect, useRef, TextareaHTMLAttributes } from 'react';

/**
 * Textarea that automatically resizes its height to fit content
 * on mount and whenever the value changes (not only onInput).
 */
export default function AutoResizeTextarea(
  props: TextareaHTMLAttributes<HTMLTextAreaElement>,
) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const el = ref.current;
    if (!el) return;
    el.style.height = 'auto';
    el.style.height = `${el.scrollHeight}px`;
  }, [props.value]);

  return <textarea ref={ref} {...props} />;
}
