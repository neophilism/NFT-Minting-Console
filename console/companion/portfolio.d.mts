export interface CompanionMaterial {name:string;sha256:string;delivery:string;license:string}
export interface CompanionProject {id:string;title:string;materials?:CompanionMaterial[]}
export interface CompanionConfig {enabled:boolean;projects?:CompanionProject[];enabledTokenIds?:number[]}
export interface CompanionAssignment {readonly tokenId:number;readonly projects:readonly CompanionProject[]}
export interface CompanionPlan {
 readonly enabled:boolean;readonly balanced:boolean;readonly allMaterialsDefined:boolean;
 readonly assignments:readonly CompanionAssignment[];readonly frequencies:Readonly<Record<string,number>>;
 readonly enabledTokenIds:readonly number[];
}
export declare const AOTV_TOKENS:40;
export declare const AOTV_PROJECTS:40;
export declare const PROJECTS_PER_TOKEN:2;
export declare function planCompanionCollection(config:CompanionConfig):CompanionPlan;
export declare function renderCompanionSchedule(plan:CompanionPlan,tokenId:number):string|null;
export declare function renderCompanionExport(plan:CompanionPlan):{
 readonly enabled:boolean;readonly balanced:boolean;readonly tokens:readonly unknown[];
 readonly draft?:boolean;readonly notReadyForMint?:boolean;readonly tokenCount?:number;
 readonly schemaVersion?:number;readonly collection?:string;
};
