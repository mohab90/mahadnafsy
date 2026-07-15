import { useEffect } from 'react';
import { useSiteData } from '../context/SiteDataContext';
import { useCommunityStore } from './useCommunityStore';
import { useCrmStore } from './useCrmStore';
import { useFinanceStore } from './useFinanceStore';
import { useLmsStore } from './useLmsStore';
import { useSystemStore } from './useSystemStore';

export function SiteDataStoreBridge() {
  const data = useSiteData();

  useEffect(() => {
    const crm = useCrmStore.getState();
    crm.setSubscribers(data.subscribers);
    crm.setLeads(data.leads);
    crm.setStaffScopedSubscribers(data.staffScopedSubscribers);
    crm.setStaffScopedLeads(data.staffScopedLeads);
    crm.setStaffMembers(data.staffMembers);
    crm.setConsultations(data.consultations);
    crm.setDaqqiRounds(data.daqqiRounds);
    crm.setJoinUsApplications(data.joinUsApplications);
    crm.setContactMessages(data.contactMessages);
    crm.setInboxConversations(data.inboxConversations);
    crm.setMySubscriberLoaded(data.mySubscriberLoaded);
  }, [
    data.subscribers,
    data.leads,
    data.staffScopedSubscribers,
    data.staffScopedLeads,
    data.staffMembers,
    data.consultations,
    data.daqqiRounds,
    data.joinUsApplications,
    data.contactMessages,
    data.inboxConversations,
    data.mySubscriberLoaded,
  ]);

  useEffect(() => {
    const lms = useLmsStore.getState();
    lms.setCourses(data.courses);
    lms.setBundles(data.bundles);
    lms.setLectures(data.lectures);
    lms.setChapters(data.chapters);
    lms.setCourseQuizzes(data.courseQuizzes);
    lms.setQuizAttempts(data.quizAttempts);
    lms.setLiveStreams(data.liveStreams);
    lms.setTherapists(data.therapists);
    lms.setTestimonials(data.testimonials);
  }, [
    data.courses,
    data.bundles,
    data.lectures,
    data.chapters,
    data.courseQuizzes,
    data.quizAttempts,
    data.liveStreams,
    data.therapists,
    data.testimonials,
  ]);

  useEffect(() => {
    const finance = useFinanceStore.getState();
    finance.setOrders(data.orders);
    finance.setExpenses(data.expenses);
    finance.setDiscounts(data.discounts);
  }, [data.orders, data.expenses, data.discounts]);

  useEffect(() => {
    const community = useCommunityStore.getState();
    community.setCommunityPosts(data.communityPosts);
    community.setCommunityLibraryItems(data.communityLibraryItems);
    community.setCommunityVideos(data.communityVideos);
    community.setCommunityEvents(data.communityEvents);
  }, [
    data.communityPosts,
    data.communityLibraryItems,
    data.communityVideos,
    data.communityEvents,
  ]);

  useEffect(() => {
    const system = useSystemStore.getState();
    system.setContent(data.content);
    system.setActivityLogs(data.activityLogs);
    system.setNotifications(data.notifications);
    system.setAutomationWorkflows(data.automationWorkflows);
    system.setAdminAiConfig(data.adminAiConfig);
    system.setAiAgentConfig(data.aiAgentConfig);
    system.setMessagingChannels(data.messagingChannels);
    system.setFbLeadAdsConfig(data.fbLeadAdsConfig);
    system.setCurrency(data.currency);
    system.setRemoteReady(data.remoteReady);
  }, [
    data.content,
    data.activityLogs,
    data.notifications,
    data.automationWorkflows,
    data.adminAiConfig,
    data.aiAgentConfig,
    data.messagingChannels,
    data.fbLeadAdsConfig,
    data.currency,
    data.remoteReady,
  ]);

  return null;
}
