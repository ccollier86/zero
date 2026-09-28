'use client';

import * as React from 'react';
import { motion, type Variants } from 'motion/react';

import {
  getVariants,
  useAnimateIconContext,
  IconWrapper,
  type IconProps,
} from '#zero/components/animate-ui/icons/icon';

type EyeProps = IconProps<keyof typeof animations>;

const animations = {
  default: {
    group: {
      initial: { scale: 1 },
      animate: {
        scale: [1, 1.05, 1],
        transition: { duration: 0.4, ease: 'easeInOut' },
      },
    },
    lid: {
      initial: { pathLength: 1, opacity: 1 },
      animate: {
        pathLength: [0, 1],
        opacity: [0, 1],
        transition: { duration: 0.5, ease: 'easeInOut' },
      },
    },
    pupil: {
      initial: { scale: 1, opacity: 1 },
      animate: {
        scale: [0, 1.1, 1],
        opacity: [0, 1],
        transition: { duration: 0.4, ease: 'easeOut', delay: 0.15 },
      },
    },
  } satisfies Record<string, Variants>,
} as const;

function IconComponent({ size, ...props }: EyeProps) {
  const { controls } = useAnimateIconContext();
  const variants = getVariants(animations);

  return (
    <motion.svg
      xmlns="http://www.w3.org/2000/svg"
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      variants={variants.group}
      initial="initial"
      animate={controls}
      {...props}
    >
      <motion.path
        d="M2.062 12.348a1 1 0 0 1 0-.696 10.75 10.75 0 0 1 19.876 0 1 1 0 0 1 0 .696 10.75 10.75 0 0 1-19.876 0"
        variants={variants.lid}
        initial="initial"
        animate={controls}
      />
      <motion.circle
        cx="12"
        cy="12"
        r="3"
        variants={variants.pupil}
        initial="initial"
        animate={controls}
      />
    </motion.svg>
  );
}

function Eye(props: EyeProps) {
  return <IconWrapper icon={IconComponent} {...props} />;
}

export {
  animations,
  Eye,
  Eye as EyeIcon,
  type EyeProps,
  type EyeProps as EyeIconProps,
};
