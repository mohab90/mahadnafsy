import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  Activity, AlertCircle, Award, BarChart2, Bell, CheckCheck, Clock,
  Columns, Download, FolderKanban, Inbox, Link2, MapPin, MessageCircle, MessageSquare,
  Phone, Plus, RefreshCw, Search, Settings, Share2, Star, Tag, TrendingUp, Upload, UserPlus, Users, X,
} from 'lucide-react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  CartesianGrid, Legend, PieChart, Pie, Cell,
} from 'recharts';
import { useSiteData } from '../../../context/SiteDataContext';
import { useBranches } from '../../../hooks/useBranches';
import { mysqlAdmin, mysqlClient } from '../../../lib/mysqlapi';
import type {
  LeadItem, LeadStatus, CommunicationRecord, SalesTarget, Course, Bundle,
} from '../../../types';
import { CrmSettingsModal, DEFAULT_CRM_SETTINGS } from './CrmSettingsModal';
import type { CrmSettings, NotifyFn } from './CrmSettingsModal';
import { DEFAULT_SOURCES, ONLINE_EXCLUDED_SOURCES, isOnlineSource, EMPTY_LEAD_DRAFT } from './crmConstants';

