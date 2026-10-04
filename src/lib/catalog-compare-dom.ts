type Product={name:string;brandLabel:string;detailHref:string;compareValues?:Record<string,string|null>};
type Field={key:string;label:string};
export function renderCatalogCompareTable({head,body,products,fields,itemLabel,prefix}:{head:HTMLElement;body:HTMLElement;products:Product[];fields:Field[];itemLabel:string;prefix:"brand"|"products"}){
  const document=head.ownerDocument;
  const cell=(tag:"th"|"td",value:string,scope?:string)=>{const node=document.createElement(tag);node.textContent=value;if(scope)node.setAttribute("scope",scope);return node;};
  const heading=document.createElement("tr");heading.append(cell("th",itemLabel,"col"));
  for(const product of products){const th=cell("th","","col"),container=document.createElement("div"),strong=document.createElement("strong"),brand=document.createElement("span");container.className=`${prefix}-compare__column-heading`;brand.textContent=product.brandLabel;
    if(/^\/products\/[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*\/$/.test(product.detailHref)){const link=document.createElement("a");link.className="community-link";link.href=product.detailHref;link.textContent=product.name;strong.append(link);}else strong.textContent=product.name;
    container.append(strong,brand);th.append(container);heading.append(th);
  }
  head.replaceChildren(heading);
  const rows=fields.map(field=>{const row=document.createElement("tr");row.append(cell("th",field.label,"row"));for(const product of products)row.append(cell("td",product.compareValues?.[field.key]||"TBD"));return row;});
  body.replaceChildren(...rows);
}
