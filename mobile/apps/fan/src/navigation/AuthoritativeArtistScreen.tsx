import React from 'react';
import ArtistScreen from '../screens/ArtistScreen';

/**
 * Artist content lock state is server-owned. Historical callers could pass
 * `unlocked: true` and ArtistScreen would locally clear every lock. Strip that
 * value at the navigation boundary so route/deep-link state can never grant
 * playback entitlement.
 */
export default function AuthoritativeArtistScreen(props: any) {
  const rawParams = props?.route?.params ?? {};
  const { unlocked: _ignoredClientEntitlement, ...safeParams } = rawParams;
  const route = { ...props.route, params: safeParams };
  return <ArtistScreen {...props} route={route} />;
}
