import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import PriceRows from '../../../client/components/checkout/PriceRows';
import EgyptianIdLine from '../../../client/components/checkout/EgyptianIdLine';

/** The checkout's price rows and the national-ID line as the server-side renderer prints them, for the tests that compare markup. */
export const renderRows = (props: React.ComponentProps<typeof PriceRows>): string => renderToStaticMarkup(<PriceRows {...props} />);
export const renderLine = (props: React.ComponentProps<typeof EgyptianIdLine>): string => renderToStaticMarkup(<EgyptianIdLine {...props} />);
