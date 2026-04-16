import { xylonTemplate } from './xylon';
import { OfficeTemplate } from './types';

const templates: Record<string, OfficeTemplate> = {
    [xylonTemplate.id]: xylonTemplate,
    xylon: xylonTemplate,
    default: xylonTemplate,
};

export const getOfficeTemplate = (templateId?: string): OfficeTemplate => {
    if (!templateId) return xylonTemplate;
    return templates[templateId] || xylonTemplate;
};

export type { OfficeTemplate, ScenarioScript, AgentTemplate } from './types';
