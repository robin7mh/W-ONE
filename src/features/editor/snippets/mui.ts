import type { Snippet } from '@shared/types/migrate'

// MUI (Material UI) snippets, built into W-ONE — the same prefixes as the
// "MUI Snippets" VS Code extension (vscodeshift.mui-snippets, MIT), so
// muscle memory carries over. Each adds its imports from @mui/material.

const V = '${1|text,contained,outlined|}'
const C = 'primary,secondary,inherit,success,error,info,warning'
const S = 'small,medium,large'

type Entry = [prefix: string, description: string, names: string[], body: string]

const ENTRIES: Entry[] = [
  ['muiAccordion', 'MUI <Accordion>', ['Accordion', 'AccordionSummary', 'AccordionDetails', 'Typography'], '<Accordion>\n\t<AccordionSummary aria-controls="${1:panel}-content" id="${1:panel}-header">\n\t\t<Typography>${2:Title}</Typography>\n\t</AccordionSummary>\n\t<AccordionDetails>\n\t\t$0\n\t</AccordionDetails>\n</Accordion>'],
  ['muiAccordionControlled', 'MUI <Accordion> (controlled)', ['Accordion', 'AccordionSummary', 'AccordionDetails', 'Typography'], '<Accordion expanded={${1:expanded} === \'${2:panel}\'} onChange={${3:handleChange}(\'${2:panel}\')}>\n\t<AccordionSummary aria-controls="${2:panel}-content" id="${2:panel}-header">\n\t\t<Typography>${4:Title}</Typography>\n\t</AccordionSummary>\n\t<AccordionDetails>\n\t\t$0\n\t</AccordionDetails>\n</Accordion>'],
  ['muiAppBar', 'MUI <AppBar>', ['AppBar', 'Toolbar', 'Typography'], '<AppBar position="${1|static,fixed,sticky,absolute,relative|}">\n\t<Toolbar>\n\t\t<Typography variant="h6">${2:Title}</Typography>\n\t\t$0\n\t</Toolbar>\n</AppBar>'],
  ['muiAppBarMenu', 'MUI <AppBar> with menu button', ['AppBar', 'Toolbar', 'Typography', 'IconButton', 'Button'], '<AppBar position="static">\n\t<Toolbar>\n\t\t<IconButton edge="start" color="inherit" aria-label="menu">\n\t\t\t$1\n\t\t</IconButton>\n\t\t<Typography variant="h6" sx={{ flexGrow: 1 }}>${2:Title}</Typography>\n\t\t<Button color="inherit">${3:Login}</Button>\n\t</Toolbar>\n</AppBar>'],
  ['muiBottomNavigation', 'MUI <BottomNavigation>', ['BottomNavigation'], '<BottomNavigation value={${1:value}} onChange={(event, newValue) => ${2:setValue}(newValue)} showLabels>\n\t$0\n</BottomNavigation>'],
  ['muiBottomNavigationAction', 'MUI <BottomNavigationAction>', ['BottomNavigationAction'], '<BottomNavigationAction label="${1:Label}" value="${2:value}" icon={$3} />'],
  ['muiButton', 'MUI <Button>', ['Button'], `<Button variant="${V}" color="\${2|${C}|}">$0</Button>`],
  ['muiButtonGroup', 'MUI <ButtonGroup>', ['ButtonGroup', 'Button'], `<ButtonGroup variant="${V}" color="\${2|${C}|}" aria-label="\${3:button group}">\n\t<Button>$4</Button>\n\t<Button>$5</Button>\n</ButtonGroup>`],
  ['muiButtonGroupSize', 'MUI <ButtonGroup> with size', ['ButtonGroup', 'Button'], `<ButtonGroup size="\${1|${S}|}" aria-label="\${2:button group}">\n\t<Button>$3</Button>\n\t<Button>$4</Button>\n</ButtonGroup>`],
  ['muiButtonGroupVertical', 'MUI <ButtonGroup> (vertical)', ['ButtonGroup', 'Button'], '<ButtonGroup orientation="vertical" aria-label="${1:vertical button group}">\n\t<Button>$2</Button>\n\t<Button>$3</Button>\n</ButtonGroup>'],
  ['muiButtonSize', 'MUI <Button> with size', ['Button'], `<Button variant="${V}" size="\${2|${S}|}">$0</Button>`],
  ['muiButtonText', 'MUI text <Button>', ['Button'], '<Button>$0</Button>'],
  ['muiButtonWithIcon', 'MUI <Button> with icon', ['Button'], `<Button variant="${V}" \${2|startIcon,endIcon|}={$3}>$0</Button>`],
  ['muiCardHeader', 'MUI <Card> with <CardHeader>', ['Card', 'CardHeader', 'CardContent'], '<Card>\n\t<CardHeader title="${1:Title}" subheader="${2:Subheader}" avatar={$3} action={$4} />\n\t<CardContent>\n\t\t$0\n\t</CardContent>\n</Card>'],
  ['muiCardMedia', 'MUI <Card> with <CardMedia>', ['Card', 'CardMedia', 'CardContent'], '<Card>\n\t<CardMedia component="img" height="${1:140}" image="${2:src}" alt="${3:alt}" />\n\t<CardContent>\n\t\t$0\n\t</CardContent>\n</Card>'],
  ['muiCheckboxLabel', 'MUI <Checkbox> with label', ['FormControlLabel', 'Checkbox'], '<FormControlLabel control={<Checkbox checked={${1:checked}} onChange={${2:handleChange}} />} label="${3:Label}" />'],
  ['muiCheckboxLabelPlacement', 'MUI <Checkbox> with label placement', ['FormControlLabel', 'Checkbox'], '<FormControlLabel value="${1:value}" control={<Checkbox />} label="${2:Label}" labelPlacement="${3|end,start,top,bottom|}" />'],
  ['muiContainer', 'MUI <Container>', ['Container'], '<Container maxWidth="${1|xs,sm,md,lg,xl|}">\n\t$0\n</Container>'],
  ['muiDialog', 'MUI <Dialog>', ['Dialog', 'DialogTitle', 'DialogContent', 'DialogContentText', 'DialogActions', 'Button'], '<Dialog open={${1:open}} onClose={${2:handleClose}} aria-labelledby="${3:dialog}-title">\n\t<DialogTitle id="${3:dialog}-title">${4:Title}</DialogTitle>\n\t<DialogContent>\n\t\t<DialogContentText>$5</DialogContentText>\n\t</DialogContent>\n\t<DialogActions>\n\t\t<Button onClick={${2:handleClose}}>${6:Cancel}</Button>\n\t\t<Button onClick={$7}>${8:OK}</Button>\n\t</DialogActions>\n</Dialog>'],
  ['muiDialogSimple', 'MUI simple <Dialog>', ['Dialog', 'DialogTitle'], '<Dialog open={${1:open}} onClose={${2:handleClose}}>\n\t<DialogTitle>${3:Title}</DialogTitle>\n\t$0\n</Dialog>'],
  ['muiDrawerPermanent', 'MUI permanent <Drawer>', ['Drawer'], '<Drawer variant="permanent" anchor="${1|left,right,top,bottom|}">\n\t$0\n</Drawer>'],
  ['muiDrawerPersistent', 'MUI persistent <Drawer>', ['Drawer'], '<Drawer variant="persistent" anchor="${1|left,right,top,bottom|}" open={${2:open}}>\n\t$0\n</Drawer>'],
  ['muiDrawerTemporary', 'MUI temporary <Drawer>', ['Drawer'], '<Drawer anchor="${1|left,right,top,bottom|}" open={${2:open}} onClose={${3:handleClose}}>\n\t$0\n</Drawer>'],
  ['muiEndAdornment', 'MUI <InputAdornment> at the end', ['InputAdornment'], 'InputProps={{ endAdornment: <InputAdornment position="end">$1</InputAdornment> }}'],
  ['muiFab', 'MUI <Fab>', ['Fab'], `<Fab color="\${1|${C}|}" aria-label="\${2:add}">\n\t$0\n</Fab>`],
  ['muiFabExtended', 'MUI extended <Fab>', ['Fab'], '<Fab variant="extended" aria-label="${1:label}">\n\t$2\n\t${3:Label}\n</Fab>'],
  ['muiFormControl', 'MUI <FormControl>', ['FormControl', 'FormLabel', 'FormHelperText'], '<FormControl>\n\t<FormLabel>${1:Label}</FormLabel>\n\t$0\n\t<FormHelperText>$2</FormHelperText>\n</FormControl>'],
  ['muiFormControlGroup', 'MUI <FormControl> with <FormGroup>', ['FormControl', 'FormLabel', 'FormGroup', 'FormHelperText'], '<FormControl component="fieldset">\n\t<FormLabel component="legend">${1:Label}</FormLabel>\n\t<FormGroup>\n\t\t$0\n\t</FormGroup>\n\t<FormHelperText>$2</FormHelperText>\n</FormControl>'],
  ['muiGridContainer', 'MUI <Grid container>', ['Grid'], '<Grid container spacing={${1:2}}>\n\t<Grid size={${2:6}}>\n\t\t$0\n\t</Grid>\n</Grid>'],
  ['muiGridContainerCenter', 'MUI centered <Grid container>', ['Grid'], '<Grid container spacing={${1:2}} justifyContent="center" alignItems="center">\n\t$0\n</Grid>'],
  ['muiGridContainerFull', 'MUI full <Grid container>', ['Grid'], '<Grid container direction="${1|row,row-reverse,column,column-reverse|}" justifyContent="${2|flex-start,center,flex-end,space-between,space-around,space-evenly|}" alignItems="${3|flex-start,center,flex-end,stretch,baseline|}" spacing={${4:2}}>\n\t$0\n</Grid>'],
  ['muiIconButton', 'MUI <IconButton>', ['IconButton'], `<IconButton aria-label="\${1:label}" color="\${2|${C}|}" size="\${3|${S}|}">\n\t$0\n</IconButton>`],
  ['muiImageListSubheader', 'MUI <ImageList> with subheader', ['ImageList', 'ImageListItem', 'ListSubheader'], '<ImageList>\n\t<ImageListItem key="Subheader" cols={2}>\n\t\t<ListSubheader component="div">${1:Subheader}</ListSubheader>\n\t</ImageListItem>\n\t{${2:items}.map((item) => (\n\t\t<ImageListItem key={item.img}>\n\t\t\t<img src={item.img} alt={item.title} loading="lazy" />\n\t\t</ImageListItem>\n\t))}\n</ImageList>'],
  ['muiImageListTilebar', 'MUI <ImageList> with title bars', ['ImageList', 'ImageListItem', 'ImageListItemBar'], '<ImageList>\n\t{${1:items}.map((item) => (\n\t\t<ImageListItem key={item.img}>\n\t\t\t<img src={item.img} alt={item.title} loading="lazy" />\n\t\t\t<ImageListItemBar title={item.title} subtitle={item.author} />\n\t\t</ImageListItem>\n\t))}\n</ImageList>'],
  ['muiMenu', 'MUI <Menu>', ['Menu', 'MenuItem'], '<Menu anchorEl={${1:anchorEl}} open={Boolean(${1:anchorEl})} onClose={${2:handleClose}}>\n\t<MenuItem onClick={${2:handleClose}}>${3:Item}</MenuItem>\n\t$0\n</Menu>'],
  ['muiMenuItem', 'MUI <MenuItem>', ['MenuItem'], '<MenuItem value="${1:value}">${2:Label}</MenuItem>'],
  ['muiMenuPopupState', 'MUI <Menu> with a trigger button', ['Menu', 'MenuItem', 'Button'], '<Button onClick={(event) => ${1:setAnchorEl}(event.currentTarget)}>${2:Open}</Button>\n<Menu anchorEl={${3:anchorEl}} open={Boolean(${3:anchorEl})} onClose={() => ${1:setAnchorEl}(null)}>\n\t<MenuItem onClick={() => ${1:setAnchorEl}(null)}>${4:Item}</MenuItem>\n</Menu>'],
  ['muiRadioGroup', 'MUI <RadioGroup>', ['FormControl', 'FormLabel', 'RadioGroup', 'FormControlLabel', 'Radio'], '<FormControl>\n\t<FormLabel id="${1:radio}-label">${2:Label}</FormLabel>\n\t<RadioGroup aria-labelledby="${1:radio}-label" name="${1:radio}" value={${3:value}} onChange={${4:handleChange}}>\n\t\t<FormControlLabel value="${5:a}" control={<Radio />} label="${6:A}" />\n\t\t$0\n\t</RadioGroup>\n</FormControl>'],
  ['muiRadioLabel', 'MUI <Radio> with label', ['FormControlLabel', 'Radio'], '<FormControlLabel value="${1:value}" control={<Radio />} label="${2:Label}" />'],
  ['muiRadioLabelPlacement', 'MUI <Radio> with label placement', ['FormControlLabel', 'Radio'], '<FormControlLabel value="${1:value}" control={<Radio />} label="${2:Label}" labelPlacement="${3|end,start,top,bottom|}" />'],
  ['muiSelectItem', 'MUI <Select>', ['FormControl', 'InputLabel', 'Select', 'MenuItem'], '<FormControl fullWidth>\n\t<InputLabel id="${1:select}-label">${2:Label}</InputLabel>\n\t<Select labelId="${1:select}-label" value={${3:value}} label="${2:Label}" onChange={${4:handleChange}}>\n\t\t<MenuItem value="${5:value}">${6:Item}</MenuItem>\n\t\t$0\n\t</Select>\n</FormControl>'],
  ['muiSliderContinuous', 'MUI continuous <Slider>', ['Slider'], '<Slider value={${1:value}} onChange={${2:handleChange}} aria-label="${3:label}" />'],
  ['muiSliderDiscrete', 'MUI discrete <Slider>', ['Slider'], '<Slider defaultValue={${1:30}} step={${2:10}} marks min={${3:0}} max={${4:100}} valueLabelDisplay="auto" aria-label="${5:label}" />'],
  ['muiSnackbar', 'MUI <Snackbar>', ['Snackbar'], '<Snackbar open={${1:open}} autoHideDuration={${2:6000}} onClose={${3:handleClose}} message="${4:Message}" />'],
  ['muiSnackbarContent', 'MUI <SnackbarContent>', ['SnackbarContent'], '<SnackbarContent message="${1:Message}" action={$2} />'],
  ['muiStartAdornment', 'MUI <InputAdornment> at the start', ['InputAdornment'], 'InputProps={{ startAdornment: <InputAdornment position="start">$1</InputAdornment> }}'],
  ['muiStep', 'MUI <Step>', ['Step', 'StepLabel'], '<Step key={${1:label}}>\n\t<StepLabel>{${1:label}}</StepLabel>\n</Step>'],
  ['muiStepContent', 'MUI <Step> with content', ['Step', 'StepLabel', 'StepContent', 'Typography'], '<Step key={${1:label}}>\n\t<StepLabel>{${1:label}}</StepLabel>\n\t<StepContent>\n\t\t<Typography>$2</Typography>\n\t</StepContent>\n</Step>'],
  ['muiStepOptional', 'MUI optional <Step>', ['Step', 'StepLabel', 'Typography'], '<Step key={${1:label}}>\n\t<StepLabel optional={<Typography variant="caption">${2:Optional}</Typography>}>{${1:label}}</StepLabel>\n</Step>'],
  ['muiStepper', 'MUI <Stepper>', ['Stepper', 'Step', 'StepLabel'], '<Stepper activeStep={${1:activeStep}}${2: alternativeLabel}>\n\t{${3:steps}.map((label) => (\n\t\t<Step key={label}>\n\t\t\t<StepLabel>{label}</StepLabel>\n\t\t</Step>\n\t))}\n</Stepper>'],
  ['muiSwipeableViews', 'MUI <Tabs> with swipeable panels', ['Tabs', 'Tab', 'Box'], '<Box>\n\t<Tabs value={${1:value}} onChange={${2:handleChange}} variant="fullWidth">\n\t\t<Tab label="${3:One}" />\n\t\t<Tab label="${4:Two}" />\n\t</Tabs>\n\t$0\n</Box>'],
  ['muiSwitch', 'MUI <Switch>', ['Switch'], '<Switch checked={${1:checked}} onChange={${2:handleChange}} inputProps={{ \'aria-label\': \'${3:label}\' }} />'],
  ['muiSwitchLabel', 'MUI <Switch> with label', ['FormControlLabel', 'Switch'], '<FormControlLabel control={<Switch checked={${1:checked}} onChange={${2:handleChange}} />} label="${3:Label}" />'],
  ['muiSwitchLabelPlacement', 'MUI <Switch> with label placement', ['FormControlLabel', 'Switch'], '<FormControlLabel value="${1:value}" control={<Switch />} label="${2:Label}" labelPlacement="${3|end,start,top,bottom|}" />'],
  ['muiTabPanel', 'MUI tab panel', ['Box'], '<div role="tabpanel" hidden={${1:value} !== ${2:index}} id="tabpanel-${2:index}" aria-labelledby="tab-${2:index}">\n\t{${1:value} === ${2:index} && <Box sx={{ p: 3 }}>$0</Box>}\n</div>'],
  ['muiTabs', 'MUI <Tabs>', ['Tabs', 'Tab'], '<Tabs value={${1:value}} onChange={${2:handleChange}} aria-label="${3:tabs}">\n\t<Tab label="${4:One}" />\n\t<Tab label="${5:Two}" />\n\t$0\n</Tabs>'],
  ['muiTabsScrollable', 'MUI scrollable <Tabs>', ['Tabs', 'Tab'], '<Tabs value={${1:value}} onChange={${2:handleChange}} variant="scrollable" scrollButtons="auto" aria-label="${3:tabs}">\n\t<Tab label="${4:One}" />\n\t$0\n</Tabs>'],
  ['muiTextField', 'MUI <TextField>', ['TextField'], '<TextField id="${1:id}" label="${2:Label}" value={${3:value}} onChange={${4:handleChange}} />'],
  ['muiTextFieldMore', 'MUI <TextField> with options', ['TextField'], '<TextField id="${1:id}" label="${2:Label}" variant="${3|outlined,filled,standard|}" ${4|required,disabled,multiline,fullWidth|} helperText="$5" />'],
  ['muiTextFieldSelect', 'MUI <TextField select>', ['TextField', 'MenuItem'], '<TextField id="${1:id}" label="${2:Label}" select value={${3:value}} onChange={${4:handleChange}}>\n\t<MenuItem value="${5:value}">${6:Item}</MenuItem>\n\t$0\n</TextField>'],
  ['muiTextFieldVariant', 'MUI <TextField> with variant', ['TextField'], '<TextField id="${1:id}" label="${2:Label}" variant="${3|outlined,filled,standard|}" />'],
  ['muiTooltip', 'MUI <Tooltip>', ['Tooltip'], '<Tooltip title="${1:Title}" placement="${2|top,bottom,left,right|}">\n\t$0\n</Tooltip>'],
  ['muiTypography', 'MUI <Typography>', ['Typography'], '<Typography variant="${1|h1,h2,h3,h4,h5,h6,subtitle1,subtitle2,body1,body2,caption,button,overline|}">$0</Typography>']
]

/** The MUI snippets for JavaScript and TypeScript files (JSX included). */
export const MUI_SNIPPETS: Snippet[] = ['javascript', 'typescript'].flatMap((language) =>
  ENTRIES.map(([prefix, description, names, body]) => ({ name: prefix, language, prefix, body, description, imports: { from: '@mui/material', names } }))
)
