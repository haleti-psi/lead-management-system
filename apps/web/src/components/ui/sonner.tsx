import { Toaster as Sonner, type ToasterProps } from 'sonner';

/** App toast surface (shadcn + sonner). Mounted once near the app root; call
 * `toast(...)` / `toast.error(...)` from anywhere. Styled with the design tokens
 * so toasts match light/dark themes. */
function Toaster(props: ToasterProps): JSX.Element {
  return (
    <Sonner
      className="toaster group"
      toastOptions={{
        classNames: {
          toast:
            'group toast group-[.toaster]:bg-background group-[.toaster]:text-foreground group-[.toaster]:border-border group-[.toaster]:shadow-lg',
          description: 'group-[.toast]:text-muted-foreground',
          actionButton: 'group-[.toast]:bg-primary group-[.toast]:text-primary-foreground',
          cancelButton: 'group-[.toast]:bg-muted group-[.toast]:text-muted-foreground',
          error: 'group-[.toaster]:border-destructive',
        },
      }}
      {...props}
    />
  );
}

export { Toaster };
