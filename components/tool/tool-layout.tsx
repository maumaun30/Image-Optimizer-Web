import { ShieldCheck } from "lucide-react";
import { AnimatedShinyText } from "@/components/ui/animated-shiny-text";
import { BlurFade } from "@/components/ui/blur-fade";

/**
 * Tool page frame. Desktop (≥1024px): input and options on the left, live queue on
 * the right, sticky while the left column scrolls. Below that: one column, queue last.
 */
export function ToolLayout({
  title,
  description,
  children,
  queue,
}: {
  title: string;
  description: string;
  children: React.ReactNode;
  queue: React.ReactNode;
}) {
  return (
    <main className="relative mx-auto box-border w-full max-w-[720px] px-4 py-5 sm:px-6 sm:py-8 lg:grid lg:max-w-[1136px] lg:grid-cols-[minmax(0,1fr)_440px] lg:items-start lg:gap-8 lg:px-8 lg:py-10">
      <section className="flex flex-col gap-4 sm:gap-5">
        <BlurFade duration={0.35} offset={6} blur="4px">
        <header className="flex flex-col gap-2 sm:gap-2.5">
          <h1 className="text-2xl leading-[30px] font-semibold tracking-tight sm:text-[26px] sm:leading-8 lg:text-[28px] lg:leading-[34px]">
            {title}
          </h1>
          <p className="text-muted-foreground text-sm leading-5 sm:text-[15px] sm:leading-[22px]">
            {description}
          </p>
          <PrivacyBadge />
        </header>
        </BlurFade>
        {children}
      </section>
      <BlurFade duration={0.35} delay={0.04} offset={6} blur="4px" className="mt-5 sm:mt-6 lg:sticky lg:top-24 lg:mt-0">
        {queue}
      </BlurFade>
    </main>
  );
}

/** Shine runs once on mount, then the badge is static. */
function PrivacyBadge() {
  return (
    <span className="border-border bg-card text-muted-foreground inline-flex items-center gap-2 self-start rounded-xl border px-3 py-1.5 text-xs leading-4 font-medium sm:h-7 sm:rounded-full sm:py-0">
      <ShieldCheck aria-hidden="true" className="text-success size-3.5 flex-none" strokeWidth={2} />
      <AnimatedShinyText className="mx-0 max-w-none text-inherit [animation-iteration-count:1] [animation-fill-mode:forwards] dark:text-inherit">
        Processed on your device when possible · server files auto-delete
      </AnimatedShinyText>
    </span>
  );
}
