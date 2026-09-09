import { createContext, useContext } from 'react';
import type { SiteDataShape } from './SiteDataContext';

/**
 * The context is one object built by one useMemo with thirty-seven dependencies,
 * and seventy-two screens read it. So a lead poll — which runs on a timer —
 * gives that object a new identity and every subscribed screen re-renders,
 * including the twelve that read nothing but the course catalogue.
 *
 * These three contexts carry the same values, grouped by how often they change.
 * They are provided *around* the wide one rather than instead of it, so nothing
 * reading useSiteData() is affected at all; a screen moves to a narrow hook once
 * someone has checked that everything it reads sits in one slice, and from then
 * on it only re-renders when that slice changes.
 *
 * Each slice carries the mutations that belong with its data. Those functions
 * are stable, so bringing them along costs nothing and saves a screen from
 * subscribing to the wide context just to call addBundle.
 *
 * The shapes are Picked from SiteDataShape rather than restated, so a field
 * cannot drift from the value actually provided — if a key is renamed there,
 * this stops compiling.
 *
 * Putting a key in the wrong group cannot break a screen: useSiteData still
 * provides all of them. It only means a screen wakes more often than it needs to.
 */

/** Catalogue, content and settings — plus the session, which changes at login. */
export type StaticDataSlice = Pick<SiteDataShape,
  | 'courses' | 'bundles' | 'therapists' | 'testimonials' | 'lectures' | 'chapters'
  | 'content' | 'discounts' | 'courseQuizzes' | 'liveStreams'
  | 'communityPosts' | 'communityLibraryItems' | 'communityVideos' | 'communityEvents'
  | 'automationWorkflows' | 'adminAiConfig' | 'aiAgentConfig' | 'messagingChannels'
  | 'fbLeadAdsConfig' | 'currency' | 'authUser' | 'isAdmin'
  | 'addBundle' | 'updateBundle' | 'deleteBundle'
  | 'addTestimonial' | 'updateTestimonial' | 'deleteTestimonial'
  | 'addDiscount' | 'updateDiscount' | 'deleteDiscount'
  | 'addLiveStream' | 'updateLiveStream' | 'deleteLiveStream'
  | 'setContentValue' | 'setContentValues' | 'setAdminAiConfig'
  | 'setMessagingChannels' | 'setAiAgentConfig' | 'addJoinUsApplication'
>;

/** People, and everything that moves while the team is working. */
export type CrmDataSlice = Pick<SiteDataShape,
  | 'leads' | 'leadStats' | 'subscribers' | 'staffScopedLeads' | 'staffScopedSubscribers'
  | 'staffMembers' | 'consultations' | 'joinUsApplications' | 'contactMessages'
  | 'inboxConversations' | 'notifications' | 'activityLogs' | 'daqqiRounds'
>;

export type FinanceDataSlice = Pick<SiteDataShape, 'orders' | 'expenses' | 'quizAttempts'>;

export const StaticDataContext = createContext<StaticDataSlice | null>(null);
export const CrmDataContext = createContext<CrmDataSlice | null>(null);
export const FinanceDataContext = createContext<FinanceDataSlice | null>(null);

function useSlice<T>(context: React.Context<T | null>, name: string): T {
  const value = useContext(context);
  if (!value) throw new Error(`${name} must be used inside SiteDataProvider`);
  return value;
}

/** Catalogue, content and settings. Re-renders only when those change. */
export const useStaticData = () => useSlice(StaticDataContext, 'useStaticData');

/** Leads, subscribers, staff and the rest of the working record. */
export const useCrmData = () => useSlice(CrmDataContext, 'useCrmData');

/** Orders, expenses and quiz attempts. */
export const useFinanceData = () => useSlice(FinanceDataContext, 'useFinanceData');
