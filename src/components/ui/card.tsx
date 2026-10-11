/** Compatibility path only; the surfaces/card family owns the native Card implementation. */
export {
  Card, CardHeader, CardTitle, CardDescription, CardContent, CardFooter,
  CardAction, CardMedia, CardByline, CardMeta, CardStatus, CardSection,
} from '../surfaces/card/card';
export type { CardProps, CardDensity, CardBylineProps, CardStatusProps } from '../surfaces/card/card';
