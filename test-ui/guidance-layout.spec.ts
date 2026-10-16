import {test,expect} from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';
test('all twelve tutorial cards wrap inside desktop and mobile dialogs',async({page},info)=>{
  await page.goto('/');await page.getByRole('button',{name:'Help & tutorials',exact:true}).click();
  const dialog=page.getByRole('dialog',{name:'Help and guided tutorials'});
  await expect(dialog.getByRole('button',{name:/^Start /})).toHaveCount(12);
  expect(await dialog.evaluate(el=>el.scrollWidth<=el.clientWidth+1)).toBe(true);
  expect(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth)).toBe(true);
  expect((await new AxeBuilder({page}).withTags(['wcag2a','wcag2aa','wcag21a','wcag21aa']).analyze()).violations).toEqual([]);
  await dialog.screenshot({path:`test-results/${info.project.name}-tutorial-catalog.png`});
  await page.keyboard.press('Escape');await expect(dialog).not.toBeVisible();await expect(page.getByRole('button',{name:'Help & tutorials',exact:true})).toBeFocused();
});
