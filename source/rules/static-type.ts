"use strict";

import {TemplatingBindingLanguage, InterpolationBindingExpression} from 'aurelia-templating-binding';
import {ViewResources, BindingLanguage, BehaviorInstruction} from 'aurelia-templating';
import {AccessMember, AccessScope, AccessKeyed/*, AccessThis*/} from 'aurelia-binding';
import {Container} from 'aurelia-dependency-injection';
import * as ts from 'typescript';

import {Rule, Parser, Issue, IssueSeverity} from 'template-lint';
import {Reflection} from '../reflection';
import {Attribute} from 'parse5';

import 'aurelia-polyfills';

import * as Path from 'path';

/**
 *  Rule to ensure static type usage is valid
 */
export class StaticTypeRule extends Rule {
    private expInterp: RegExp = /\${.+}/
    private base: string;

    private resources: ViewResources;
    private bindingLanguage: TemplatingBindingLanguage;
    private container: Container;

    private viewModelName: string;
    private viewModelFile: string;
    private viewModelSource: ts.SourceFile;
    private viewModelClass: ts.ClassDeclaration;

    constructor(private reflection: Reflection,
        base?: string) {
        super();
        this.base = base || "";

        this.container = new Container();
        this.resources = this.container.get(ViewResources);
        this.bindingLanguage = this.container.get(TemplatingBindingLanguage);
    }

    init(parser: Parser, path?: string) {

        if (!path || path.trim() == "")
            return;

        this.resolveViewModel(path);

        if (!this.viewModelClass)
            return;

        parser.on("startTag", (name, attrs, selfClosing, location) => {
            /*let resources = this.resources;
            let bindingLanguage = resources.getBindingLanguage(this.bindingLanguage);

            for (let i = 0, ii = attrs.length; i < ii; ++i) {
                let attr = attrs[i];
                let attrName = attr.name;
                let attrValue = attr.value;
                let info: any = bindingLanguage.inspectAttribute(resources, name, attrName, attrValue);
                let type = resources.getAttribute(info.attrName);

                let instruction = bindingLanguage.createAttributeInstruction(
                    resources, <any>{ tagName: name }, info, undefined);               
            }*/
        });

        parser.on("text", (text, location) => {
            this.examineText(text, location.line);
        });
    }


    private examineText(text: string, lineStart: number) {
        let exp = this.bindingLanguage.inspectTextContent(this.resources, text);

        if (!exp)
            return;

        let lineOffset = 0;

        exp.parts.forEach(part => {
            if (part.name !== undefined) {
                let chain = this.flattenAccessChain(part);
                if (chain.length > 0)
                    this.examineAccessMember(this.viewModelClass, chain, lineStart + lineOffset);
            } else if (part.ancestor !== undefined) {
                //this or ancestor access ($parent)
            }
            else {
                let newLines = (<string>part).match(/\n|\r/);

                if (newLines)
                    lineOffset += newLines.length;
            }
        });
    }

    private examineAccessMember(decl: ts.ClassDeclaration, chain: any[], line: number) {
        let name = chain[0].name;

        //find the member;
        let member = decl.members
            .filter(x => x.kind == ts.SyntaxKind.PropertyDeclaration)            
            .find(x => (<any>x.name).text == name.text);

        if (!member)
            this.reportAccessMemberIssue(name, decl, line);
    }

    private flattenAccessChain(access) {
        let chain = [];

        while (access !== undefined) {
            chain.push(access);
            access = access.object;
        }

        return chain.reverse();
    }

    //https://github.com/aurelia/templating/blob/3e925bb57e179e0f566eabc5882b7e416cbb44ec/src/view-compiler.js
    private configureProperties(instruction, resources) {
        let type = instruction.type;
        let attrName = instruction.attrName;
        let attributes = instruction.attributes;
        let property;
        let key;
        let value;

        let knownAttribute = resources.mapAttribute(attrName);
        if (knownAttribute && attrName in attributes && knownAttribute !== attrName) {
            attributes[knownAttribute] = attributes[attrName];
            delete attributes[attrName];
        }

        for (key in attributes) {
            value = attributes[key];

            if (value !== null && typeof value === 'object') {
                property = type.attributes[key];

                if (property !== undefined) {
                    value.targetProperty = property.name;
                } else {
                    value.targetProperty = key;
                }
            }
        }
    }

    private resolveViewModel(path: string) {
        let viewFileInfo = Path.parse(path);
        this.viewModelFile = `${viewFileInfo.name}.ts`;
        let viewName = this.capitalize(viewFileInfo.name);
        this.viewModelName = `${viewName}ViewModel`; // convention for now

        this.viewModelSource = this.reflection.pathToSource[this.viewModelFile];
        let classes = this.viewModelSource.statements.filter(x => x.kind == ts.SyntaxKind.ClassDeclaration);

        this.viewModelClass = <ts.ClassDeclaration>classes.find(x => (<ts.ClassDeclaration>x).name.text == this.viewModelName);
    }

    private capitalize(text) {
        return text.charAt(0).toUpperCase() + text.slice(1).toLowerCase();
    }

    private reportAccessMemberIssue(member: string, decl: ts.ClassDeclaration, line: number) {
        let msg = `cannot find '${member}' in type '${decl.name.text}'`;
        let issue = new Issue({
            message: msg,
            line: line,
            column: 0,
            severity: IssueSeverity.Error
        });

        this.reportIssue(issue);
    }
}

