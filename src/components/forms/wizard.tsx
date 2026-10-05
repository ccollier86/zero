'use client';

/**
 * Owns schema-backed multi-step form presentation and navigation. Step
 * configuration is validated before rendering; useForm owns values and submit
 * state, while the caller owns completion effects and backend authorization.
 */

import * as React from 'react';
import { useState, useMemo, useCallback } from 'react';
import { motion, AnimatePresence } from 'motion/react';
import { AnimateIcon } from '#zero/components/animate-ui/icons/icon';
import { Check } from '#zero/components/animate-ui/icons/check';
import { ChevronRight } from '#zero/components/animate-ui/icons/chevron-right';
import { Loader } from '#zero/components/animate-ui/icons/loader';
import * as v from 'valibot';
import type { SchemaDescriptor } from '../../schema/define-schema';
import type { FieldMeta } from '../../schema/field-types';
import type { Row } from '../../sync/types';
import { useForm } from '../../hooks/use-form';
import { FieldRenderer } from './field-renderer';
import { Button } from '#zero/components/ui/button';
import { Progress } from '#zero/components/animate-ui/components/radix/progress';
import { cn } from '#zero/lib/utils';

// ─── Types ──────────────────────────────────────────────────────────────────

export interface WizardStep {
  /** Field names included in this step */
  fields: string[];
  /** Step title displayed in the progress indicator */
  title: string;
  /** Optional description shown below the title */
  description?: string;
}

export interface WizardProps<T extends Row = Row> {
  schema: SchemaDescriptor;
  /**
   * At least one step; every declared field must exist in the schema.
   * Replacing the schema or step titles/fields resets navigation and completion,
   * not the form instance. Equivalent step arrays retain navigation.
   */
  steps: WizardStep[];
  defaultValues?: Partial<T>;
  onComplete: (data: T) => void | Promise<void>;
  onStepChange?: (stepIndex: number) => void;
  /** Label for the final submit button. Default: 'Complete' */
  completeLabel?: string;
  /** Number of CSS grid columns per step. Default: 1 */
  columns?: number;
  className?: string;
}

// ─── Step indicator ─────────────────────────────────────────────────────────

interface StepIndicatorProps {
  steps: WizardStep[];
  currentStep: number;
  completedSteps: Set<number>;
}

function StepIndicator({ steps, currentStep, completedSteps }: StepIndicatorProps) {
  const progressPercent = steps.length > 1
    ? (currentStep / (steps.length - 1)) * 100
    : 100;

  return (
    <div data-slot="wizard-progress" className="space-y-4">
      {/* Progress bar */}
      <Progress value={progressPercent} />

      {/* Step dots + labels */}
      <div className="flex justify-between">
        {steps.map((step, i) => {
          const isCompleted = completedSteps.has(i);
          const isCurrent = i === currentStep;
          const isPast = i < currentStep;

          return (
            <div
              key={step.title}
              className={cn(
                'flex flex-col items-center gap-1.5',
                steps.length > 4 && 'flex-1',
              )}
            >
              {/* Circle */}
              <motion.div
                className={cn(
                  'flex size-8 items-center justify-center rounded-full border-2 text-xs font-semibold transition-colors',
                  isCurrent && 'border-primary bg-primary text-primary-foreground',
                  isCompleted && 'border-primary bg-primary text-primary-foreground',
                  !isCurrent && !isCompleted && 'border-muted-foreground/30 text-muted-foreground',
                )}
                animate={isCurrent ? { scale: [1, 1.1, 1] } : { scale: 1 }}
                transition={isCurrent ? { duration: 0.4, ease: 'easeInOut' } : undefined}
              >
                <AnimatePresence mode="wait">
                  {isCompleted ? (
                    <motion.div
                      key="check"
                      initial={{ scale: 0, rotate: -90 }}
                      animate={{ scale: 1, rotate: 0 }}
                      exit={{ scale: 0 }}
                      transition={{ type: 'spring' as const, stiffness: 300, damping: 20 }}
                    >
                      <AnimateIcon animate>
                        <Check size={14} />
                      </AnimateIcon>
                    </motion.div>
                  ) : (
                    <motion.span
                      key="number"
                      initial={{ opacity: 0 }}
                      animate={{ opacity: 1 }}
                      exit={{ opacity: 0 }}
                    >
                      {i + 1}
                    </motion.span>
                  )}
                </AnimatePresence>
              </motion.div>

              {/* Label */}
              <span
                className={cn(
                  'text-xs font-medium text-center max-w-[80px] leading-tight',
                  (isCurrent || isCompleted) ? 'text-foreground' : 'text-muted-foreground',
                )}
              >
                {step.title}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}

// ─── Slide animation ────────────────────────────────────────────────────────

const slideVariants = {
  enter: (direction: number) => ({
    x: direction > 0 ? 80 : -80,
    opacity: 0,
  }),
  center: {
    x: 0,
    opacity: 1,
  },
  exit: (direction: number) => ({
    x: direction > 0 ? -80 : 80,
    opacity: 0,
  }),
};

const slideTransition = {
  type: 'spring' as const,
  stiffness: 300,
  damping: 30,
};

// ─── Component ──────────────────────────────────────────────────────────────

/**
 * Presents validated schema fields across steps, retaining form values when the
 * step layout changes while reconciling navigation before rendering that layout.
 * Completion delegates to useForm's awaited caller-owned onComplete callback.
 */
function Wizard<T extends Row = Row>({
  schema,
  steps,
  defaultValues,
  onComplete,
  onStepChange,
  completeLabel = 'Complete',
  columns = 1,
  className,
}: WizardProps<T>) {
  if (steps.length === 0) {
    throw new Error('Wizard requires at least one step.');
  }
  for (const [stepIndex, step] of steps.entries()) {
    for (const fieldName of step.fields) {
      if (!schema.fields.has(fieldName)) {
        throw new Error(
          `Wizard step ${stepIndex + 1} references unknown schema field '${fieldName}'.`,
        );
      }
    }
  }

  const stepLayout = JSON.stringify(steps.map(({ title, fields }) => [title, fields]));
  const [navigation, setNavigation] = useState(() => ({
    schema,
    stepLayout,
    currentStep: 0,
    direction: 0,
    completedSteps: new Set<number>(),
  }));
  // Reconcile before indexing/rendering the replacement props. An effect alone
  // would leave one render using a stale index (and potentially crash).
  const configurationChanged = navigation.schema !== schema
    || navigation.stepLayout !== stepLayout;
  const activeNavigation = configurationChanged
    ? { schema, stepLayout, currentStep: 0, direction: 0, completedSteps: new Set<number>() }
    : navigation;
  if (configurationChanged) setNavigation(activeNavigation);
  const { currentStep, direction, completedSteps } = activeNavigation;

  const form = useForm<T>({
    schema,
    defaultValues,
    mode: 'create',
    onSubmit: onComplete,
  });

  const step = steps[currentStep]!;
  const isFirstStep = currentStep === 0;
  const isLastStep = currentStep === steps.length - 1;

  // Get field metas for the current step
  const stepFields = useMemo(
    () =>
      step.fields
        .map((name) => {
          const meta = form.getFieldMeta(name);
          return meta ? { name, meta } : null;
        })
        .filter(Boolean) as Array<{ name: string; meta: FieldMeta }>,
    [step.fields, form],
  );

  // Validate only the current step's fields
  const validateCurrentStep = useCallback((): boolean => {
    let valid = true;
    for (const fieldName of step.fields) {
      const fieldSchema = schema.getFieldSchema(fieldName);
      if (!fieldSchema) continue;
      const value = form.watch(fieldName);
      const result = v.safeParse(fieldSchema, value);
      if (!result.success) {
        valid = false;
        // Trigger blur to show error
        form.register(fieldName).onBlur();
      }
    }
    return valid;
  }, [step.fields, schema, form]);

  const goToStep = useCallback(
    (target: number) => {
      setNavigation((previous) => ({
        ...previous,
        direction: target > currentStep ? 1 : -1,
        currentStep: target,
      }));
      onStepChange?.(target);
    },
    [currentStep, onStepChange],
  );

  const handleNext = useCallback(() => {
    if (!validateCurrentStep()) return;
    setNavigation((previous) => ({
      ...previous,
      completedSteps: new Set(previous.completedSteps).add(currentStep),
    }));
    goToStep(currentStep + 1);
  }, [validateCurrentStep, currentStep, goToStep]);

  const handleBack = useCallback(() => {
    goToStep(currentStep - 1);
  }, [currentStep, goToStep]);

  const handleSubmit = useCallback(async () => {
    if (!validateCurrentStep()) return;
    setNavigation((previous) => ({
      ...previous,
      completedSteps: new Set(previous.completedSteps).add(currentStep),
    }));
    await form.handleSubmit();
  }, [validateCurrentStep, currentStep, form]);

  const gridStyle = columns > 1
    ? { display: 'grid', gridTemplateColumns: `repeat(${columns}, 1fr)`, gap: '1rem' }
    : undefined;

  return (
    <div data-slot="wizard" className={cn('space-y-6', className)}>
      {/* Progress indicator */}
      <StepIndicator
        steps={steps}
        currentStep={currentStep}
        completedSteps={completedSteps}
      />

      {/* Step header */}
      <div>
        <h3 className="text-lg font-semibold">{step.title}</h3>
        {step.description && (
          <p className="text-sm text-muted-foreground mt-1">{step.description}</p>
        )}
      </div>

      {/* Step content with slide animation */}
      <div className="relative overflow-hidden">
        <AnimatePresence mode="wait" custom={direction}>
          <motion.div
            key={currentStep}
            custom={direction}
            variants={slideVariants}
            initial="enter"
            animate="center"
            exit="exit"
            transition={slideTransition}
          >
            <div style={gridStyle} className={columns <= 1 ? 'space-y-4' : undefined}>
              {stepFields.map(({ name, meta }) => (
                <FieldRenderer
                  key={name}
                  name={name}
                  meta={meta}
                  registration={form.register(name)}
                />
              ))}
            </div>
          </motion.div>
        </AnimatePresence>
      </div>

      {/* Navigation buttons */}
      <div className="flex items-center justify-between pt-2">
        <Button
          type="button"
          variant="outline"
          onClick={handleBack}
          disabled={isFirstStep}
          className={cn(isFirstStep && 'invisible')}
        >
          Back
        </Button>

        <div className="flex items-center gap-2">
          {/* Step counter */}
          <span className="text-xs text-muted-foreground tabular-nums">
            {currentStep + 1} of {steps.length}
          </span>

          {isLastStep ? (
            <Button onClick={handleSubmit} disabled={form.isSubmitting}>
              {form.isSubmitting && (
                <AnimateIcon animate loop>
                  <Loader size={16} />
                </AnimateIcon>
              )}
              {completeLabel}
            </Button>
          ) : (
            <Button onClick={handleNext}>
              Next
              <AnimateIcon animateOnHover>
                <ChevronRight size={16} />
              </AnimateIcon>
            </Button>
          )}
        </div>
      </div>
    </div>
  );
}

export { Wizard };
